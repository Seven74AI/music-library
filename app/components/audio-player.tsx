import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type RoomAutoplayOutcome } from "#app/components/audio-player-room-playback.ts";
import { useAudioPlayerMediaSession } from "./audio-player-media-session";
import {
  recoverPlaybackSourceAfterMediaError,
  useAudioPlayerOfflineSourceSwap,
  useAudioPlayerTrackSource,
  isPlaybackSourceReady,
  type PendingPlaybackSource,
} from "./audio-player-offline-source";
import { useAudioPlayerEmitPlayEvent } from "./audio-player-play-events";
import {
  runRoomSpeakerProgressHeartbeat,
  useAudioPlayerRequestRoomTransport,
  useAudioPlayerRoomSpeakerPlayback,
  useRoomAutoplayOutcomeRef,
} from "./audio-player-room-speaker";
import { useAudioPlayerSleepTimer } from "./audio-player-sleep-timer";
import { recordAutoplayFailure } from "#app/hooks/use-autoplay-guide";
import { type FullTrack } from "#app/types/frontend/shared";
import { clearBlobUrlCache } from "#app/features/offline-storage/resolve-playback-url.client.ts";
import { type RoomTransportAction } from "#app/features/party-room/types.ts";
import { useOnlineStatus } from "#app/hooks/use-online-status.ts";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { useTrackAudioFileDownload } from "#app/hooks/use-track-audio-file-download.ts";
import { updateMediaSessionPositionState } from "#app/utils/media-session.client.ts";
import { coverImageUrl, nowPlayingCoverPixelSize } from "#app/utils/cover-image-url.ts";
import { adjustVolumeStep, getPlayerKeyboardAction } from "#app/utils/player-keyboard-shortcuts.ts";
import {
  DEFAULT_PLAYER_VOLUME,
  readStoredVolume,
  writeStoredVolume,
} from "#app/utils/player-preferences.ts";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  generatePlayId,
  getMediaErrorMessage,
  isDurationKnown,
  isPlayInterrupted,
} from "./audio-player-format";
import {
  PlayerDesktopBar,
  PlayerMiniBar,
  PlayerNowPlayingSheet,
  type PlayerChromeProps,
} from "./player-chrome";
import { QueueOnlyPlayerBar } from "./queue-only-player-bar";

type Track = FullTrack;

interface AudioPlayerProps {
  track: Track | null;
  isVisible: boolean;
  onClose: () => void;
  onStartQueuePlayback?: () => void;
  hasQueuedPlayback?: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  loopMode: "off" | "all" | "one";
  isShuffleEnabled: boolean;
  playbackToken?: number;
  wantsAutoPlayRef?: React.MutableRefObject<boolean>;
  unlockAutoplayRef?: React.MutableRefObject<
    ((trackId: string, cachedUrl: string) => boolean) | null
  >;
  /** Provider-driven pause (e.g. track row) without restarting queue state. */
  pausePlaybackRef?: React.MutableRefObject<(() => void) | null>;
  /** Resume the current element from its paused position without a playback-token bump. */
  resumePlaybackRef?: React.MutableRefObject<(() => void) | null>;
  /** When set, emit room play events instead of personal UsageEvents. */
  roomSpeaker?: { roomId: string; code: string } | null;
  /**
   * Outlives transient `roomSpeaker` while room audio is still active after host-mode exit.
   */
  roomPlayEventTargetRef?: React.MutableRefObject<{ roomId: string; code: string } | null>;
  /** Server-driven play/pause while in room speaker mode. */
  roomPlaying?: boolean | null;
  /** Bumps on every room playback snapshot so unchanged isPlaying still re-applies. */
  roomPlaybackTick?: number;
  roomTransportRef?: React.MutableRefObject<
    | ((action: Extract<RoomTransportAction, { action: "play" } | { action: "pause" }>) => void)
    | null
  >;
  /**
   * Room speaker only. Fired after play() settles so a blocked autoplay can
   * leave the room paused without the personal toast/dialog stack.
   */
  onRoomAutoplayOutcome?: (outcome: RoomAutoplayOutcome) => void;
  /** Prefer this audio URL (e.g. speaker grant) over personal /resources/audio. */
  audioSrcOverride?: string;
  /**
   * Reports whether the media element is actually playing. Track rows use this
   * so a paused current track does not keep a pause icon.
   */
  onPlayingChange?: (isPlaying: boolean) => void;
}

function usePublishToastBottomOffset(
  chromeRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  layoutKey: string,
) {
  useLayoutEffect(() => {
    const node = chromeRef.current;
    if (!active || !node) {
      document.body.style.removeProperty("--toast-bottom-offset");
      return;
    }

    const apply = () => {
      const offset = Math.max(0, Math.round(window.innerHeight - node.getBoundingClientRect().top));
      document.body.style.setProperty("--toast-bottom-offset", `${offset}px`);
    };

    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    window.addEventListener("resize", apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", apply);
      document.body.style.removeProperty("--toast-bottom-offset");
    };
  }, [active, chromeRef, layoutKey]);
}

export function AudioPlayer(props: AudioPlayerProps) {
  const {
    track,
    isVisible,
    onClose,
    onStartQueuePlayback,
    hasQueuedPlayback = false,
    onNext,
    onPrevious,
    onToggleLoop,
    onToggleShuffle,
    hasNext,
    hasPrevious,
    loopMode,
    isShuffleEnabled,
    playbackToken = 0,
    wantsAutoPlayRef,
    unlockAutoplayRef,
    pausePlaybackRef,
    resumePlaybackRef,
    roomSpeaker = null,
    roomPlayEventTargetRef,
    roomPlaying = null,
    roomPlaybackTick = 0,
    roomTransportRef,
    onRoomAutoplayOutcome,
    audioSrcOverride,
    onPlayingChange,
  } = props;
  const audioRef = useRef<HTMLAudioElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  usePublishToastBottomOffset(chromeRef, isVisible, track?.id ?? "queue");
  const [isPlaying, setIsPlaying] = useState(false);
  useLayoutEffect(() => {
    onPlayingChange?.(isPlaying);
  }, [isPlaying, onPlayingChange]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(DEFAULT_PLAYER_VOLUME);
  const [isMuted, setIsMuted] = useState(false);
  const preMuteVolumeRef = useRef(DEFAULT_PLAYER_VOLUME);
  const previousPlaybackTokenRef = useRef<number | null>(null);
  const previousTrackIdRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const pendingAudioSrcRef = useRef<PendingPlaybackSource | null>(null);
  const isManualPlayRef = useRef(false);
  // User intends playback; not cleared by incidental pause from network/src swaps.
  const keepPlayingRef = useRef(false);
  const playStartedForTrackRef = useRef<string | null>(null);
  /** Play pass that already emitted `play_completed` at 50% (keyed by playId, not track id). */
  const playCompletedForPlayIdRef = useRef<string | null>(null);
  const playIdRef = useRef<string | null>(null);
  /** Previous `timeupdate` playhead — detects repeat-one wrap by backward jump. */
  const prevCurrentTimeRef = useRef(0);
  /** Set when the user seeks; suppresses wrap detection on the next `timeupdate`. */
  const userSeekRef = useRef(false);
  // Playback-progress presence for a locked speaker. Page timers are throttled
  // while the screen is hidden; timeupdate keeps lastSeenAt fresh only while
  // the playhead is actually moving.
  const speakerProgressRef = useRef<{ time: number | null; sentAt: number }>({
    time: null,
    sentAt: 0,
  });
  const onRoomAutoplayOutcomeRef = useRoomAutoplayOutcomeRef(onRoomAutoplayOutcome);
  // Last room-speaker source we started. Queue snapshots recreate `track` /
  // `roomSpeaker` without changing this key and must not rewind.
  const roomPlayKeyRef = useRef<string | null>(null);
  const { isDownloading, downloadAudioFile: handleDownload } = useTrackAudioFileDownload(
    track ? { id: track.id, title: track.title } : null,
  );
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const isOnline = useOnlineStatus();

  const requestRoomTransport = useAudioPlayerRequestRoomTransport(roomTransportRef);

  const emitPlayEvent = useAudioPlayerEmitPlayEvent(roomPlayEventTargetRef, roomSpeaker);

  // Expose a function to apply a prefetched track and play it synchronously within
  // a user gesture. This maintains autoplay permission across track changes.
  // Returns true if the track was applied and play() was initiated successfully.
  useEffect(() => {
    if (unlockAutoplayRef) {
      unlockAutoplayRef.current = (trackId: string, cachedUrl: string) => {
        const audio = audioRef.current;
        if (!audio) return false;

        // Apply the cached source synchronously within the user gesture.
        // DO NOT call setAudioSrc here - it schedules a React update that will
        // interrupt the play() call by resetting the audio element.
        audio.src = cachedUrl;
        loadedTrackIdRef.current = trackId;
        if (previousTrackIdRef.current !== trackId) {
          previousTrackIdRef.current = trackId;
          setDuration(0);
          setCurrentTime(0);
        }
        userSeekRef.current = true;
        audio.currentTime = 0;
        audio.volume = isMuted ? 0 : volume;

        // Call play() synchronously to maintain the user-gesture-initiated playback
        keepPlayingRef.current = true;
        const playPromise = audio.play();

        if (playPromise) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              keepPlayingRef.current = true;
              if (playStartedForTrackRef.current !== trackId) {
                playStartedForTrackRef.current = trackId;
                playCompletedForPlayIdRef.current = null;
                playIdRef.current = generatePlayId();
                emitPlayEvent("play_started", trackId, playIdRef.current);
              }
              // The audioSrc React state is intentionally not synced here to avoid
              // triggering a re-render that would reset the audio element mid-playback.
              // The state will naturally sync when the track fully loads via the effect.
            })
            .catch(() => {
              setIsPlaying(false);
              keepPlayingRef.current = false;
              setPlaybackError("Autoplay was prevented by your browser. Press play to start.");
              recordAutoplayFailure();
              toast({
                title: "Autoplay blocked",
                description:
                  "Your browser prevented automatic playback. Press play to start listening.",
              });
            });
        }

        return true;
      };
    }
    return () => {
      if (unlockAutoplayRef) {
        unlockAutoplayRef.current = null;
      }
    };
  }, [unlockAutoplayRef, isMuted, volume, emitPlayEvent]);

  useEffect(() => {
    if (pausePlaybackRef) {
      pausePlaybackRef.current = () => {
        if (roomSpeaker && roomTransportRef?.current) {
          requestRoomTransport("pause");
          return;
        }
        const audio = audioRef.current;
        if (!audio) return;
        keepPlayingRef.current = false;
        audio.pause();
        setIsPlaying(false);
      };
    }
    return () => {
      if (pausePlaybackRef) {
        pausePlaybackRef.current = null;
      }
    };
  }, [pausePlaybackRef, requestRoomTransport, roomSpeaker, roomTransportRef]);

  useEffect(() => {
    if (resumePlaybackRef) {
      resumePlaybackRef.current = () => {
        if (roomSpeaker && roomTransportRef?.current) {
          requestRoomTransport("play");
          return;
        }
        const audio = audioRef.current;
        if (!audio) return;
        keepPlayingRef.current = true;
        void audio
          .play()
          .then(() => {
            setIsPlaying(true);
            keepPlayingRef.current = true;
          })
          .catch(() => {
            setIsPlaying(false);
            keepPlayingRef.current = false;
          });
      };
    }
    return () => {
      if (resumePlaybackRef) {
        resumePlaybackRef.current = null;
      }
    };
  }, [resumePlaybackRef, requestRoomTransport, roomSpeaker, roomTransportRef]);

  useEffect(() => {
    setVolume(readStoredVolume());
  }, []);

  useEffect(() => {
    return () => {
      clearBlobUrlCache();
    };
  }, []);

  // Clear the media element's "user gesture lock" on the first interaction.
  // Chromium blocks audible autoplay unless the element's lock is cleared by
  // calling play()/load() within a user gesture (chromium docs/media/autoplay.md).
  // On iOS the reliable unlock is a gesture-initiated play(); we mute+play+pause
  // so we do not audibly start playback from the unlock itself.
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      const audio = audioRef.current;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      // A click that leaves the room must not stop audio that is already playing.
      if (!audio || !audio.paused) return;
      const wasMuted = audio.muted;
      audio.muted = true;
      try {
        // jsdom's play() returns undefined; browsers return a Promise.
        void Promise.resolve(audio.play())
          .then(() => {
            audio.pause();
            audio.muted = wasMuted;
          })
          .catch(() => {
            audio.muted = wasMuted;
            audio.load();
          });
      } catch {
        audio.muted = wasMuted;
        audio.load();
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const audioFile = track?.audioFiles?.length ? selectBestAudioFile(track.audioFiles) : null;
  const [audioSrc, setAudioSrc] = useState<string | undefined>(undefined);
  const audioSrcRef = useRef(audioSrc);
  audioSrcRef.current = audioSrc;
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackErrorRef = useRef<HTMLDivElement>(null);
  // Set when we had to write a URL onto the element because React state already
  // matched it. The autoplay effect must not copy the previous element's duration.
  const suppressStaleDurationRef = useRef(false);

  const stopFailedPlayback = useCallback((message: string) => {
    keepPlayingRef.current = false;
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
    setPlaybackError(message);
  }, []);

  // The fixed player grows when autoplay is blocked. Publish that extra height
  // so page padding can scroll the last rows clear of the bar.
  useLayoutEffect(() => {
    const node = playbackErrorRef.current;
    if (!node) {
      document.body.style.removeProperty("--player-error-height");
      return;
    }

    const apply = () => {
      document.body.style.setProperty("--player-error-height", `${node.offsetHeight}px`);
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      document.body.style.removeProperty("--player-error-height");
    };
  }, [playbackError]);

  const trackId = track?.id;

  useEffect(() => {
    prevCurrentTimeRef.current = 0;
    userSeekRef.current = false;
    playCompletedForPlayIdRef.current = null;
  }, [trackId]);

  useAudioPlayerTrackSource({
    audioRef,
    audioFile,
    trackId,
    audioSrcOverride,
    audioSrcRef,
    loadedTrackIdRef,
    pendingAudioSrcRef,
    suppressStaleDurationRef,
    setAudioSrc,
    setPlaybackError,
    setIsPlaying,
    setCurrentTime,
    setDuration,
  });

  useAudioPlayerOfflineSourceSwap({
    audioRef,
    isOnline,
    trackId,
    audioSrc,
    loadedTrackIdRef,
    keepPlayingRef,
    userSeekRef,
    setAudioSrc,
    setPlaybackError,
  });

  useEffect(() => {
    if (
      audioRef.current &&
      track &&
      isPlaybackSourceReady(
        track.id,
        audioSrc,
        loadedTrackIdRef.current,
        pendingAudioSrcRef.current,
      ) &&
      playbackToken !== previousPlaybackTokenRef.current
    ) {
      loadedTrackIdRef.current = track.id;
      previousPlaybackTokenRef.current = playbackToken;
      // Room speaker playback is handled by the room effect below. The personal
      // autoplay path would toast, paint the red line, and open the guide dialog
      // for the same blocked play().
      const shouldAutoPlay =
        !roomSpeaker && (wantsAutoPlayRef?.current || !isManualPlayRef.current);
      if (wantsAutoPlayRef) {
        wantsAutoPlayRef.current = false;
      }
      // Only clear the "playing" flag when NOT auto-advancing. Keeping it set
      // through gapless transitions keeps navigator.mediaSession in "playing",
      // so background audio isn't dropped on lock screens.
      if (!shouldAutoPlay) {
        setIsPlaying(false);
      }
      setCurrentTime(0);
      if (track.id !== previousTrackIdRef.current || suppressStaleDurationRef.current) {
        previousTrackIdRef.current = track.id;
        suppressStaleDurationRef.current = false;
        setDuration(0);
      } else if (
        audioRef.current.duration &&
        isFinite(audioRef.current.duration) &&
        audioRef.current.duration > 0
      ) {
        setDuration(audioRef.current.duration);
      }
      audioRef.current.volume = isMuted ? 0 : volume;
      if (shouldAutoPlay) {
        keepPlayingRef.current = true;
        userSeekRef.current = true;
        audioRef.current.currentTime = 0;
        let playPromise: Promise<void> | undefined;
        try {
          playPromise = audioRef.current.play() ?? undefined;
        } catch (error) {
          playPromise = Promise.reject(error);
        }
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (audioRef.current?.error) {
                setIsPlaying(false);
                keepPlayingRef.current = false;
                return;
              }
              setIsPlaying(true);
              keepPlayingRef.current = true;
              if (track && playStartedForTrackRef.current !== track.id) {
                playStartedForTrackRef.current = track.id;
                playCompletedForPlayIdRef.current = null;
                playIdRef.current = generatePlayId();
                emitPlayEvent("play_started", track.id, playIdRef.current);
              }
            })
            .catch((error: unknown) => {
              setIsPlaying(false);
              keepPlayingRef.current = false;
              // A failed source reports its own message. An aborted play() from a
              // newer load must not replace that with the autoplay toast.
              if (audioRef.current?.error || isPlayInterrupted(error)) return;
              setPlaybackError("Autoplay was prevented by your browser. Press play to start.");
              recordAutoplayFailure();
              toast({
                title: "Autoplay blocked",
                description:
                  "Your browser prevented automatic playback. Press play to start listening.",
              });
            });
        }
      }
      isManualPlayRef.current = false;
    }
  }, [
    trackId,
    track,
    audioSrc,
    playbackToken,
    volume,
    isMuted,
    wantsAutoPlayRef,
    emitPlayEvent,
    roomSpeaker,
  ]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
    writeStoredVolume(volume);
  }, [volume, isMuted]);

  const togglePlayPause = useCallback(async () => {
    if (!audioRef.current) return;

    const wasPlaying = !audioRef.current.paused;
    isManualPlayRef.current = true;

    if (roomSpeaker && roomTransportRef?.current) {
      requestRoomTransport(wasPlaying ? "pause" : "play");
      return;
    }

    try {
      if (wasPlaying) {
        keepPlayingRef.current = false;
        audioRef.current.pause();
      } else {
        keepPlayingRef.current = true;
        await audioRef.current.play();
        if (track && playStartedForTrackRef.current !== track.id) {
          playStartedForTrackRef.current = track.id;
          playCompletedForPlayIdRef.current = null;
          playIdRef.current = generatePlayId();
          emitPlayEvent("play_started", track.id, playIdRef.current);
        }
      }
    } catch (_error) {
      setIsPlaying(!audioRef.current.paused);
      keepPlayingRef.current = !audioRef.current.paused;
      setPlaybackError("Unable to play this track. Try again or check your connection.");
      toast({
        title: "Playback failed",
        description: "Could not start playback. Please try again.",
        variant: "destructive",
      });
    }
  }, [track, emitPlayEvent, requestRoomTransport, roomSpeaker, roomTransportRef]);

  useAudioPlayerRoomSpeakerPlayback({
    audioRef,
    roomSpeaker,
    roomPlaying,
    roomPlaybackTick,
    track,
    audioSrc,
    loadedTrackIdRef,
    pendingAudioSrcRef,
    roomPlayKeyRef,
    keepPlayingRef,
    userSeekRef,
    playStartedForTrackRef,
    playCompletedForPlayIdRef,
    playIdRef,
    onRoomAutoplayOutcomeRef,
    setIsPlaying,
    setPlaybackError,
    emitPlayEvent,
  });

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getPlayerKeyboardAction(event);
      if (!action) return;

      event.preventDefault();

      switch (action) {
        case "toggle-play-pause":
          void togglePlayPause();
          break;
        case "next":
          if (hasNext) onNext();
          break;
        case "previous":
          if (hasPrevious) onPrevious();
          break;
        case "volume-up":
          setIsMuted(false);
          setVolume((current) => adjustVolumeStep(current, "up"));
          break;
        case "volume-down":
          setIsMuted(false);
          setVolume((current) => adjustVolumeStep(current, "down"));
          break;
        case "mute-toggle":
          setIsMuted((current) => {
            if (current) {
              setVolume(preMuteVolumeRef.current);
              return false;
            }
            preMuteVolumeRef.current = volume;
            return true;
          });
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNext, hasPrevious, isVisible, onNext, onPrevious, togglePlayPause, volume]);

  useAudioPlayerMediaSession({
    audioRef,
    track,
    isVisible,
    isPlaying,
    hasNext,
    hasPrevious,
    roomSpeaker,
    roomTransportRef,
    requestRoomTransport,
    onNext,
    onPrevious,
    keepPlayingRef,
    playStartedForTrackRef,
    playCompletedForPlayIdRef,
    playIdRef,
    userSeekRef,
    setIsPlaying,
    setPlaybackError,
    emitPlayEvent,
  });

  const { sleepTimerLabel, startSleepTimer, clearSleepTimer } = useAudioPlayerSleepTimer({
    audioRef,
    roomSpeaker,
    roomTransportRef,
    requestRoomTransport,
    keepPlayingRef,
    setIsPlaying,
  });

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number.parseFloat(event.target.value);
    if (Number.isNaN(nextVolume)) return;
    setIsMuted(false);
    setVolume(nextVolume);
  };

  const toggleMute = () => {
    setIsMuted((current) => {
      if (current) {
        setVolume(preMuteVolumeRef.current);
        return false;
      }
      preMuteVolumeRef.current = volume;
      return true;
    });
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = loopMode === "one";
    }
  }, [loopMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      // Don't update time while seeking to avoid conflicts
      if (!audio.seeking) {
        setCurrentTime(audio.currentTime);
        updateMediaSessionPositionState(audio);
      }
      runRoomSpeakerProgressHeartbeat({ roomSpeaker, audio, speakerProgressRef });
      const currentTime = audio.currentTime;
      if (loopMode === "one" && trackId) {
        if (userSeekRef.current) {
          prevCurrentTimeRef.current = currentTime;
          userSeekRef.current = false;
        } else {
          const prevTime = prevCurrentTimeRef.current;
          const trackDuration = audio.duration;
          if (trackDuration > 0 && isFinite(trackDuration)) {
            const head = Math.min(1, trackDuration * 0.3);
            const delta = prevTime - currentTime;
            const minJump = Math.min(0.5, head);
            if (currentTime < head && delta > minJump) {
              playIdRef.current = generatePlayId();
              playCompletedForPlayIdRef.current = null;
              playStartedForTrackRef.current = trackId;
              emitPlayEvent("play_started", trackId, playIdRef.current);
            }
          }
          prevCurrentTimeRef.current = currentTime;
        }
      }
      const playCompletionKey = playIdRef.current ?? (trackId ? `track:${trackId}` : null);
      if (
        trackId &&
        playCompletionKey &&
        playCompletedForPlayIdRef.current !== playCompletionKey &&
        audio.duration > 0 &&
        currentTime / audio.duration >= 0.5
      ) {
        playCompletedForPlayIdRef.current = playCompletionKey;
        emitPlayEvent("play_completed", trackId, playIdRef.current);
      }
    };
    const handlePlay = () => {
      setIsPlaying(true);
      keepPlayingRef.current = true;
    };
    const handlePause = () => {
      // Spec fires pause before ended at natural completion. Ignore that pause
      // while we intend to auto-advance so Media Session stays "playing".
      // User pause clears keepPlayingRef first (see togglePlayPause).
      if (keepPlayingRef.current) return;
      setIsPlaying(false);
    };
    const handleSeeking = () => {
      // Browser manages seeking state automatically via audio.seeking property
      // This listener is kept for potential future use (e.g., showing loading indicator)
    };
    const handleSeeked = () => {
      const audioElement = audioRef.current;
      if (!audioElement) return;
      // Sync time after seeking completes - this is the authoritative event
      setCurrentTime(audioElement.currentTime);
      updateMediaSessionPositionState(audioElement);
    };
    const handleLoadedMetadata = () => {
      if (audioRef.current) {
        const newDuration = audioRef.current.duration;
        if (!isNaN(newDuration) && isFinite(newDuration) && newDuration > 0) {
          setDuration(newDuration);
          updateMediaSessionPositionState(audioRef.current);
        }
      }
    };
    const handleEnded = () => {
      if (loopMode === "one") {
        // Single-track loop: the `loop` attribute restarts it automatically.
        return;
      }
      const playCompletionKey = playIdRef.current ?? (trackId ? `track:${trackId}` : null);
      if (trackId && playCompletionKey && playCompletedForPlayIdRef.current !== playCompletionKey) {
        playCompletedForPlayIdRef.current = playCompletionKey;
        emitPlayEvent("play_completed", trackId, playIdRef.current);
      }
      if (hasNext) {
        // Auto-advance: keep the "playing" state (and Media Session) continuous
        // through the transition so background audio isn't dropped on lock
        // screens.
        keepPlayingRef.current = true;
        onNext();
      } else {
        // End of queue: actually stop.
        setIsPlaying(false);
        keepPlayingRef.current = false;
      }
    };
    const handleError = () => {
      const audioElement = audioRef.current;
      if (!audioElement?.error) return;

      const errorCode = audioElement.error.code;
      console.error(`Audio load error: ${audioElement.error.message} (code: ${errorCode})`);

      // MEDIA_ERR_NETWORK (2) and MEDIA_ERR_SRC_NOT_SUPPORTED (4) often mean a
      // stale/failed remote URL (expired presign, flaky mobile). Re-resolve a
      // fresh URL, then fall back to the offline blob before giving up.
      // Numeric codes (jsdom does not expose MediaError constants).
      if ((errorCode === 2 || errorCode === 4) && trackId) {
        const savedTime = audioElement.currentTime;
        const shouldResume = keepPlayingRef.current || !audioElement.paused;
        const previousSrc = audioElement.src;

        // Speaker grant is `/resources/rooms/audio/:id`. Personal
        // `/resources/audio/:id` 403s for catalog tracks the host does not
        // own (same reason queue auto-cache is skipped in speaker mode).
        void recoverPlaybackSourceAfterMediaError({
          trackId,
          roomSpeaker,
          audioSrcOverride,
          audioRef,
          loadedTrackIdRef,
          pendingAudioSrcRef,
          userSeekRef,
          previousSrc,
          savedTime,
          shouldResume,
          setAudioSrc,
          setPlaybackError,
        }).then((result) => {
          if (result === "failed") {
            stopFailedPlayback(getMediaErrorMessage(errorCode));
          }
        });
        return;
      }

      stopFailedPlayback(getMediaErrorMessage(errorCode));
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("seeking", handleSeeking);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("seeking", handleSeeking);
      audio.removeEventListener("seeked", handleSeeked);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [
    onNext,
    loopMode,
    trackId,
    audioSrc,
    hasNext,
    emitPlayEvent,
    roomSpeaker,
    audioSrcOverride,
    stopFailedPlayback,
  ]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;

    const newTime = parseFloat(e.target.value);
    const audio = audioRef.current;

    if (isNaN(newTime) || newTime < 0) return;

    // readyState >= 1 (HAVE_METADATA) means seeking won't raise an exception
    // Browser will handle loading the range if needed
    const readyStateCheck = audio.readyState >= 1;
    const durationCheck = duration > 0 && !isNaN(duration) && isFinite(duration);
    const canSeek = readyStateCheck || durationCheck;

    if (!canSeek) return;

    const clampedTime = duration > 0 ? Math.min(Math.max(0, newTime), duration) : newTime;

    try {
      // Optimistic update for smooth UI - seeked event will correct if needed
      audio.currentTime = clampedTime;
      userSeekRef.current = true;
      setCurrentTime(clampedTime);
      updateMediaSessionPositionState(audio);
    } catch (error) {
      console.error("Seek failed:", error);
    }
  };

  const handleSeekStart = () => {
    // Browser manages seeking state automatically
    // This handler is kept for potential future use (e.g., disabling other controls during seek)
  };

  const handleSeekEnd = () => {
    // Browser manages seeking state via audio.seeking property
    // The seeked event will fire when seeking completes
  };

  // Always mounted so the element's user-gesture lock can be unlocked on the
  // first interaction, before any track is loaded.
  const audioElement = (
    <audio ref={audioRef} src={audioSrc} loop={loopMode === "one"} preload="auto" />
  );

  if (!isVisible) {
    return audioElement;
  }

  if (!track) {
    return (
      <>
        {audioElement}
        <QueueOnlyPlayerBar
          chromeRef={chromeRef}
          onClose={onClose}
          onStartPlayback={onStartQueuePlayback}
          hasQueuedPlayback={hasQueuedPlayback}
        />
      </>
    );
  }

  const isAudioLoading = !audioSrc && !playbackError;
  const catalogDuration = track.duration ?? 0;
  const seekDuration = isDurationKnown(duration)
    ? duration
    : playbackError && isDurationKnown(catalogDuration)
      ? catalogDuration
      : duration;
  const chromeProps: PlayerChromeProps = {
    track,
    isPlaying,
    isAudioLoading,
    currentTime,
    duration: seekDuration,
    loopMode,
    isShuffleEnabled,
    isDownloading,
    sleepTimerLabel,
    hasNext,
    hasPrevious,
    isMuted,
    volume,
    onPrevious,
    onNext,
    onTogglePlayPause: togglePlayPause,
    onToggleLoop,
    onToggleShuffle,
    onClose,
    onDownload: handleDownload,
    onSeek: handleSeek,
    onSeekStart: handleSeekStart,
    onSeekEnd: handleSeekEnd,
    onVolumeChange: handleVolumeChange,
    onToggleMute: toggleMute,
    onStartSleepTimer: startSleepTimer,
    onClearSleepTimer: clearSleepTimer,
  };

  return (
    <div
      ref={chromeRef}
      data-testid="player-chrome"
      className="fixed bottom-16 left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:bottom-0"
    >
      {playbackError ? (
        <div
          ref={playbackErrorRef}
          data-testid="player-playback-error"
          className="px-4 py-3 text-sm text-destructive"
        >
          <p className="container">{playbackError}</p>
        </div>
      ) : null}
      {/* Keep the sheet-sized cover decoded while the player is mounted. The
          now-playing sheet unmounts on close; without this warm image the 320px
          URL is fetched again on every reopen (mini bar uses a smaller size). */}
      {track.coverImage?.objectKey ? (
        <img
          data-testid="player-warm-cover"
          src={coverImageUrl(track.coverImage.objectKey, nowPlayingCoverPixelSize)}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      ) : null}
      <PlayerMiniBar {...chromeProps} onOpenNowPlaying={() => setIsNowPlayingOpen(true)} />
      <PlayerNowPlayingSheet
        {...chromeProps}
        open={isNowPlayingOpen}
        onOpenChange={setIsNowPlayingOpen}
      />
      <div className="container mx-auto hidden px-4 py-3 md:block">
        <PlayerDesktopBar {...chromeProps} />
      </div>

      {audioElement}
    </div>
  );
}

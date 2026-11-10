import { useEffect, useRef, type MutableRefObject } from "react";
import {
  invalidateRemotePlaybackUrl,
  peekCachedPlaybackUrl,
  resolvePlaybackAudioUrl,
  resolveTrackPlaybackSource,
  revokePlaybackAudioUrl,
} from "#app/features/offline-storage/resolve-playback-url.client.ts";
import { swapPlaybackSource, withRecoveryNonce } from "./audio-player-format";

export type PendingPlaybackSource = { trackId: string; url: string };

/**
 * The track is ready to start only when the committed `audioSrc` is the URL we
 * intend to play. A ref updated in the same effect turn as `setAudioSrc` is
 * not enough: the previous source is still on the element for that render.
 */
export function isPlaybackSourceReady(
  trackId: string | undefined,
  audioSrc: string | undefined,
  loadedTrackId: string | null,
  pending: PendingPlaybackSource | null,
): boolean {
  if (!trackId || !audioSrc) return false;
  if (pending?.trackId === trackId) return pending.url === audioSrc;
  return loadedTrackId === trackId;
}

/** React state can still hold a URL after a gesture wrote a different one onto the element. */
export function mediaElementHasSrc(audio: HTMLAudioElement, url: string): boolean {
  if (audio.getAttribute("src") === url) return true;
  try {
    return audio.src === new URL(url, window.location.href).href;
  } catch {
    return false;
  }
}

type UseAudioPlayerTrackSourceOptions = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  audioFile: unknown;
  trackId: string | undefined;
  audioSrcOverride?: string;
  audioSrcRef: MutableRefObject<string | undefined>;
  loadedTrackIdRef: MutableRefObject<string | null>;
  pendingAudioSrcRef: MutableRefObject<PendingPlaybackSource | null>;
  suppressStaleDurationRef: MutableRefObject<boolean>;
  setAudioSrc: (src: string | undefined) => void;
  setPlaybackError: (message: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
};

export function useAudioPlayerTrackSource({
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
}: UseAudioPlayerTrackSourceOptions) {
  useEffect(() => {
    if (!audioFile || !trackId) {
      loadedTrackIdRef.current = null;
      pendingAudioSrcRef.current = null;
      setAudioSrc(undefined);
      setPlaybackError(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    // If the track is already loaded (e.g., by synchronous unlock), skip to avoid
    // interrupting ongoing playback with a redundant source update.
    if (loadedTrackIdRef.current === trackId) {
      return;
    }

    // Prefetched / already-resolved URL: apply synchronously so auto-advance
    // does not blank <audio src> and wait on async storage/network.
    // Room speaker grants use audioSrcOverride the same way. Do not mark the
    // track loaded until that URL is the committed state — otherwise autoplay
    // calls play() on the track that just ended and then drops the token.
    const cachedUrl = peekCachedPlaybackUrl(trackId);
    const directUrl = cachedUrl || audioSrcOverride || null;
    if (directUrl) {
      pendingAudioSrcRef.current = { trackId, url: directUrl };
      const audio = audioRef.current;
      const elementOnUrl = audio ? mediaElementHasSrc(audio, directUrl) : false;
      if (audioSrcRef.current === directUrl && elementOnUrl) {
        loadedTrackIdRef.current = trackId;
      } else if (audioSrcRef.current === directUrl && audio) {
        // Same React src as the track we are returning to, but the element is
        // still playing the track we just left. setAudioSrc would no-op.
        audio.src = directUrl;
        loadedTrackIdRef.current = trackId;
        suppressStaleDurationRef.current = true;
        setDuration(0);
        setCurrentTime(0);
        setPlaybackError(null);
      } else {
        loadedTrackIdRef.current = null;
        setAudioSrc(directUrl);
        setPlaybackError(null);
      }
      return () => {
        if (cachedUrl) revokePlaybackAudioUrl(trackId);
      };
    }

    pendingAudioSrcRef.current = null;
    loadedTrackIdRef.current = null;
    setAudioSrc(undefined);
    setPlaybackError(null);

    let cancelled = false;

    void resolveTrackPlaybackSource(trackId)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          pendingAudioSrcRef.current = { trackId, url };
          loadedTrackIdRef.current = trackId;
          setAudioSrc(url);
          setPlaybackError(null);
        } else {
          setPlaybackError(
            "This track is not available offline. Download it while you still have a connection.",
          );
        }
      })
      .catch((err) => {
        console.error("Failed to resolve audio URL:", err);
        if (!cancelled) {
          setAudioSrc(undefined);
          setPlaybackError("Playback failed. Try downloading this track for offline listening.");
        }
      });

    return () => {
      cancelled = true;
      revokePlaybackAudioUrl(trackId);
    };
  }, [audioFile, trackId, audioSrcOverride]);
}

type UseAudioPlayerOfflineSourceSwapOptions = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isOnline: boolean;
  trackId: string | undefined;
  audioSrc: string | undefined;
  loadedTrackIdRef: MutableRefObject<string | null>;
  keepPlayingRef: MutableRefObject<boolean>;
  userSeekRef: MutableRefObject<boolean>;
  setAudioSrc: (src: string) => void;
  setPlaybackError: (message: string | null) => void;
};

export function useAudioPlayerOfflineSourceSwap({
  audioRef,
  isOnline,
  trackId,
  audioSrc,
  loadedTrackIdRef,
  keepPlayingRef,
  userSeekRef,
  setAudioSrc,
  setPlaybackError,
}: UseAudioPlayerOfflineSourceSwapOptions) {
  const prevOnlineRef = useRef(isOnline);
  // When going offline while a track is playing, proactively swap to the
  // cached blob URL so playback continues seamlessly.  Falls back to
  // handleError recovery on MEDIA_ERR_NETWORK if the buffer drains first.
  useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    const audio = audioRef.current;
    if (!wasOnline || isOnline || !trackId || !audio || !audioSrc) return;

    // Already on a local blob — no network dependency, do not interrupt.
    if (audioSrc.startsWith("blob:")) return;

    const shouldResume = keepPlayingRef.current || !audio.paused;
    if (!shouldResume) return;

    const savedTime = audio.currentTime;

    resolvePlaybackAudioUrl(trackId).then((offlineUrl) => {
      if (!offlineUrl || !audioRef.current || loadedTrackIdRef.current !== trackId) {
        // No blob — let handleError deal with it when buffer runs out
        return;
      }
      swapPlaybackSource(audioRef.current, offlineUrl, savedTime, shouldResume, () => {
        userSeekRef.current = true;
      });
      setAudioSrc(offlineUrl);
      setPlaybackError(null);
    });
  }, [isOnline, trackId, audioSrc]);
}

/** Re-resolve remote URL or offline blob after MEDIA_ERR_NETWORK / MEDIA_ERR_SRC_NOT_SUPPORTED. */
export function recoverPlaybackSourceAfterMediaError(options: {
  trackId: string;
  roomSpeaker: { roomId: string; code: string } | null | undefined;
  audioSrcOverride?: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  loadedTrackIdRef: MutableRefObject<string | null>;
  pendingAudioSrcRef: MutableRefObject<PendingPlaybackSource | null>;
  userSeekRef: MutableRefObject<boolean>;
  previousSrc: string;
  savedTime: number;
  shouldResume: boolean;
  setAudioSrc: (src: string) => void;
  setPlaybackError: (message: string | null) => void;
}): Promise<"recovered" | "failed"> {
  const {
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
  } = options;

  if (roomSpeaker && audioSrcOverride) {
    const retryUrl = withRecoveryNonce(audioSrcOverride);
    if (audioRef.current && loadedTrackIdRef.current === trackId) {
      pendingAudioSrcRef.current = { trackId, url: retryUrl };
      swapPlaybackSource(audioRef.current, retryUrl, savedTime || 0, shouldResume, () => {
        userSeekRef.current = true;
      });
      setAudioSrc(retryUrl);
      setPlaybackError(null);
      return Promise.resolve("recovered");
    }
    return Promise.resolve("failed");
  }

  invalidateRemotePlaybackUrl(trackId);

  return (async () => {
    try {
      const freshUrl = await resolveTrackPlaybackSource(trackId);
      if (
        freshUrl &&
        freshUrl !== previousSrc &&
        audioRef.current &&
        loadedTrackIdRef.current === trackId
      ) {
        swapPlaybackSource(audioRef.current, freshUrl, savedTime || 0, shouldResume, () => {
          userSeekRef.current = true;
        });
        setAudioSrc(freshUrl);
        setPlaybackError(null);
        return "recovered" as const;
      }

      const offlineUrl = await resolvePlaybackAudioUrl(trackId);
      if (offlineUrl && audioRef.current && loadedTrackIdRef.current === trackId) {
        swapPlaybackSource(audioRef.current, offlineUrl, savedTime || 0, shouldResume, () => {
          userSeekRef.current = true;
        });
        setAudioSrc(offlineUrl);
        setPlaybackError(null);
        return "recovered" as const;
      }
      return "failed" as const;
    } catch {
      return "failed" as const;
    }
  })();
}

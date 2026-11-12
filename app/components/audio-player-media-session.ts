import { useEffect, type MutableRefObject } from "react";
import { type FullTrack } from "#app/types/frontend/shared";
import { type RoomTransportAction } from "#app/features/party-room/types.ts";
import {
  buildMediaSessionMetadata,
  clearMediaSessionPositionState,
  clampMediaSessionSeekTime,
  isMediaSessionSupported,
  updateMediaSessionPositionState,
} from "#app/utils/media-session.client.ts";
import { toast } from "#app/components/ui/use-toast.ts";
import { generatePlayId } from "./audio-player-format";

type UseAudioPlayerMediaSessionOptions = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  track: FullTrack | null;
  isVisible: boolean;
  isPlaying: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  roomSpeaker: { roomId: string; code: string } | null;
  roomTransportRef?: MutableRefObject<
    | ((action: Extract<RoomTransportAction, { action: "play" } | { action: "pause" }>) => void)
    | null
  >;
  requestRoomTransport: (action: "play" | "pause") => void;
  onNext: () => void;
  onPrevious: () => void;
  keepPlayingRef: MutableRefObject<boolean>;
  playStartedForTrackRef: MutableRefObject<string | null>;
  playCompletedForPlayIdRef: MutableRefObject<string | null>;
  playIdRef: MutableRefObject<string | null>;
  userSeekRef: MutableRefObject<boolean>;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackError: (message: string | null) => void;
  emitPlayEvent: (
    type: "play_started" | "play_completed",
    id: string,
    playId?: string | null,
  ) => void;
};

export function useAudioPlayerMediaSession({
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
}: UseAudioPlayerMediaSessionOptions) {
  useEffect(() => {
    if (!isMediaSessionSupported() || !track || !isVisible) return;

    navigator.mediaSession.metadata = new MediaMetadata(buildMediaSessionMetadata(track));

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

    navigator.mediaSession.setActionHandler("play", () => {
      if (roomSpeaker && roomTransportRef?.current) {
        requestRoomTransport("play");
        return;
      }
      if (audioRef.current?.paused) {
        keepPlayingRef.current = true;
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          void playPromise
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
            .catch(() => {
              if (!audioRef.current) return;
              setIsPlaying(!audioRef.current.paused);
              keepPlayingRef.current = !audioRef.current.paused;
              setPlaybackError("Unable to play this track. Try again or check your connection.");
              toast({
                title: "Playback failed",
                description: "Could not start playback. Please try again.",
                variant: "destructive",
              });
            });
        }
      }
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (roomSpeaker && roomTransportRef?.current) {
        requestRoomTransport("pause");
        return;
      }
      if (audioRef.current && !audioRef.current.paused) {
        keepPlayingRef.current = false;
        audioRef.current.pause();
      }
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      if (hasPrevious) onPrevious();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      if (hasNext) onNext();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (!audio || details.seekTime == null) return;

      const trackDuration = audio.duration;
      if (!trackDuration || !isFinite(trackDuration) || trackDuration <= 0) {
        return;
      }

      audio.currentTime = clampMediaSessionSeekTime(details.seekTime, trackDuration);
      userSeekRef.current = true;
      updateMediaSessionPositionState(audio);
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      if (roomSpeaker && roomTransportRef?.current) {
        requestRoomTransport("pause");
        clearMediaSessionPositionState();
        return;
      }
      const audio = audioRef.current;
      keepPlayingRef.current = false;
      if (audio && !audio.paused) {
        audio.pause();
      }
      clearMediaSessionPositionState();
    });

    const audio = audioRef.current;
    if (audio) {
      updateMediaSessionPositionState(audio);
    }

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("stop", null);
      clearMediaSessionPositionState();
    };
  }, [
    hasNext,
    hasPrevious,
    isPlaying,
    isVisible,
    onNext,
    onPrevious,
    requestRoomTransport,
    roomSpeaker,
    roomTransportRef,
    track,
    emitPlayEvent,
  ]);
}

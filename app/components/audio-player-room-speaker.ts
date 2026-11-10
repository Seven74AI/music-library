import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  outcomeFromPlayCall,
  roomStateAfterAutoplay,
  type RoomAutoplayOutcome,
} from "#app/components/audio-player-room-playback.ts";
import { sendHostHeartbeat } from "#app/features/party-room/api.client.ts";
import { type RoomTransportAction } from "#app/features/party-room/types.ts";
import { speakerProgressHeartbeatDue } from "#app/features/party-room/speaker-progress-heartbeat.ts";
import { generatePlayId } from "./audio-player-format";
import { isPlaybackSourceReady, type PendingPlaybackSource } from "./audio-player-offline-source";

export function useAudioPlayerRequestRoomTransport(
  roomTransportRef?: MutableRefObject<
    | ((action: Extract<RoomTransportAction, { action: "play" } | { action: "pause" }>) => void)
    | null
  >,
) {
  return useCallback(
    (action: "play" | "pause") => {
      roomTransportRef?.current?.({ action });
    },
    [roomTransportRef],
  );
}

type SpeakerProgressSample = { time: number | null; sentAt: number };

export function runRoomSpeakerProgressHeartbeat(options: {
  roomSpeaker: { roomId: string; code: string } | null | undefined;
  audio: HTMLAudioElement;
  speakerProgressRef: MutableRefObject<SpeakerProgressSample>;
}) {
  const { roomSpeaker, audio, speakerProgressRef } = options;
  const sample = speakerProgressRef.current;
  const decision = speakerProgressHeartbeatDue({
    active: Boolean(roomSpeaker?.code),
    paused: audio.paused,
    seeking: audio.seeking,
    currentTime: audio.currentTime,
    previousTime: sample.time,
    lastSentAtMs: sample.sentAt,
    nowMs: Date.now(),
  });
  sample.time = decision.previousTime;
  if (decision.due && roomSpeaker?.code) {
    sample.sentAt = Date.now();
    void sendHostHeartbeat(roomSpeaker.code).catch(() => {});
  }
}

type UseAudioPlayerRoomSpeakerPlaybackOptions = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  roomSpeaker: { roomId: string; code: string } | null;
  roomPlaying: boolean | null;
  roomPlaybackTick: number;
  track: { id: string } | null | undefined;
  audioSrc: string | undefined;
  loadedTrackIdRef: MutableRefObject<string | null>;
  pendingAudioSrcRef: MutableRefObject<PendingPlaybackSource | null>;
  roomPlayKeyRef: MutableRefObject<string | null>;
  keepPlayingRef: MutableRefObject<boolean>;
  userSeekRef: MutableRefObject<boolean>;
  playStartedForTrackRef: MutableRefObject<string | null>;
  playCompletedForPlayIdRef: MutableRefObject<string | null>;
  playIdRef: MutableRefObject<string | null>;
  onRoomAutoplayOutcomeRef: MutableRefObject<((outcome: RoomAutoplayOutcome) => void) | undefined>;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackError: (message: string | null) => void;
  emitPlayEvent: (
    type: "play_started" | "play_completed",
    id: string,
    playId?: string | null,
  ) => void;
};

export function useAudioPlayerRoomSpeakerPlayback({
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
}: UseAudioPlayerRoomSpeakerPlaybackOptions) {
  // Room speaker: honor server play/pause. Wait until the committed audioSrc
  // is this track — play() on the song that just ended spends the gesture
  // token and the next URL stays silent. A blocked play() leaves the room
  // paused with one explanation and does not report playback.
  useEffect(() => {
    if (!roomSpeaker) {
      roomPlayKeyRef.current = null;
    }
    if (!roomSpeaker || roomPlaying === null || !audioRef.current) return;
    const audio = audioRef.current;
    if (!roomPlaying) {
      keepPlayingRef.current = false;
      audio.pause();
      setIsPlaying(false);
      return;
    }
    if (
      !isPlaybackSourceReady(
        track?.id,
        audioSrc,
        loadedTrackIdRef.current,
        pendingAudioSrcRef.current,
      )
    ) {
      return;
    }

    const playKey = `${track?.id ?? ""}:${audioSrc ?? ""}`;
    const elementPlaying = !audio.paused;
    // Queue adds recreate `track` / `roomSpeaker` while this source is already
    // playing. Seeking to 0 would restart the song for the whole room.
    if (roomPlayKeyRef.current === playKey && elementPlaying === roomPlaying) {
      if (roomPlaying) return;
      keepPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const isNewSource = roomPlayKeyRef.current !== playKey;
    roomPlayKeyRef.current = playKey;
    let cancelled = false;
    keepPlayingRef.current = true;
    if (isNewSource) {
      try {
        userSeekRef.current = true;
        audio.currentTime = 0;
      } catch {
        // The element may not be seekable until metadata arrives.
      }
    }
    let playResult: Promise<void> | void;
    try {
      playResult = audio.play();
    } catch {
      playResult = Promise.reject(new Error("play threw"));
    }
    void outcomeFromPlayCall(playResult).then((outcome) => {
      if (cancelled) return;
      const next = roomStateAfterAutoplay(outcome);
      if (!next.isPlaying) {
        setIsPlaying(false);
        keepPlayingRef.current = false;
        if (next.explanation) setPlaybackError(next.explanation);
        onRoomAutoplayOutcomeRef.current?.(outcome);
        return;
      }
      setPlaybackError(null);
      setIsPlaying(true);
      keepPlayingRef.current = true;
      if (next.reportPlaying && track && playStartedForTrackRef.current !== track.id) {
        playStartedForTrackRef.current = track.id;
        playCompletedForPlayIdRef.current = null;
        playIdRef.current = generatePlayId();
        emitPlayEvent("play_started", track.id, playIdRef.current);
      }
      onRoomAutoplayOutcomeRef.current?.(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [roomSpeaker, roomPlaying, roomPlaybackTick, track, audioSrc, emitPlayEvent]);
}

export function useRoomAutoplayOutcomeRef(
  onRoomAutoplayOutcome?: (outcome: RoomAutoplayOutcome) => void,
) {
  const onRoomAutoplayOutcomeRef = useRef(onRoomAutoplayOutcome);
  onRoomAutoplayOutcomeRef.current = onRoomAutoplayOutcome;
  return onRoomAutoplayOutcomeRef;
}

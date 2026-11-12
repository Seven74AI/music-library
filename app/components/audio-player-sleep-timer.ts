import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { type RoomTransportAction } from "#app/features/party-room/types.ts";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  createSleepTimerEndAt,
  formatSleepTimerRemaining,
  isSleepTimerExpired,
} from "#app/utils/sleep-timer.ts";

type UseAudioPlayerSleepTimerOptions = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  roomSpeaker: { roomId: string; code: string } | null;
  roomTransportRef?: MutableRefObject<
    | ((action: Extract<RoomTransportAction, { action: "play" } | { action: "pause" }>) => void)
    | null
  >;
  requestRoomTransport: (action: "play" | "pause") => void;
  keepPlayingRef: MutableRefObject<boolean>;
  setIsPlaying: (playing: boolean) => void;
};

export function useAudioPlayerSleepTimer({
  audioRef,
  roomSpeaker,
  roomTransportRef,
  requestRoomTransport,
  keepPlayingRef,
  setIsPlaying,
}: UseAudioPlayerSleepTimerOptions) {
  const [sleepTimerEndAt, setSleepTimerEndAt] = useState<number | null>(null);
  const [sleepTimerLabel, setSleepTimerLabel] = useState<string | null>(null);

  useEffect(() => {
    if (sleepTimerEndAt === null) {
      setSleepTimerLabel(null);
      return undefined;
    }

    const updateLabel = () => {
      if (isSleepTimerExpired(sleepTimerEndAt)) {
        setSleepTimerEndAt(null);
        setSleepTimerLabel(null);
        keepPlayingRef.current = false;
        if (roomSpeaker && roomTransportRef?.current) {
          requestRoomTransport("pause");
        } else if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
        toast({
          title: "Sleep timer ended",
          description: "Playback has been stopped.",
        });
        return;
      }

      setSleepTimerLabel(formatSleepTimerRemaining(sleepTimerEndAt));
    };

    updateLabel();
    const intervalId = window.setInterval(updateLabel, 1000);
    return () => window.clearInterval(intervalId);
  }, [requestRoomTransport, roomSpeaker, roomTransportRef, sleepTimerEndAt]);

  const startSleepTimer = useCallback((minutes: number) => {
    setSleepTimerEndAt(createSleepTimerEndAt(minutes));
    toast({
      title: "Sleep timer set",
      description: `Playback will stop in ${minutes} minutes.`,
    });
  }, []);

  const clearSleepTimer = useCallback(() => {
    setSleepTimerEndAt(null);
    setSleepTimerLabel(null);
  }, []);

  return {
    sleepTimerEndAt,
    sleepTimerLabel,
    startSleepTimer,
    clearSleepTimer,
  };
}

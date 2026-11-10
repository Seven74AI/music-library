import { useCallback } from "react";
import { reportRoomPlayEvent } from "#app/features/party-room/api.client.ts";
import { reportPlayEvent } from "#app/features/usage-analytics/report-play-event.client.ts";

export function useAudioPlayerEmitPlayEvent(
  roomPlayEventTargetRef?: React.MutableRefObject<{ roomId: string; code: string } | null>,
  roomSpeaker?: { roomId: string; code: string } | null,
) {
  return useCallback(
    (type: "play_started" | "play_completed", id: string, playId?: string | null) => {
      const roomCode = roomPlayEventTargetRef?.current?.code ?? roomSpeaker?.code;
      if (roomCode) {
        reportRoomPlayEvent(
          roomCode,
          type === "play_started" ? "room_play_started" : "room_play_completed",
          id,
          playId,
        );
        return;
      }
      reportPlayEvent(type, id, playId);
    },
    [roomPlayEventTargetRef, roomSpeaker],
  );
}

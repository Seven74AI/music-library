import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { Icon } from "#app/components/ui/icon.tsx";
import { reportRoomPlayEvent } from "#app/features/party-room/api.client.ts";
import { isCurrentHost, splitRoomQueue } from "#app/features/party-room/index.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import {
  suspendPersonalPlayerSnapshot,
  takeSuspendedPersonalPlayer,
} from "#app/features/party-room/player-suspend.ts";
import { type FullTrack } from "#app/types/frontend/shared";

/**
 * Coordinates Party Room speaker mode with the personal audio player:
 * - Host device: suspend personal PlayerState persistence; play room queue;
 *   emit room play events (not personal UsageEvent).
 * - Other participants: read-only now-playing bar linking to the room.
 */
export function RoomSpeakerBridge() {
  const party = useOptionalPartyRoom();
  const audio = useAudioPlayer();
  const wasSpeakerRef = useRef(false);
  const lastPlayIdRef = useRef<string | null>(null);

  const room = party?.room ?? null;
  const isSpeaker = Boolean(room && room.status === "open" && isCurrentHost(room));

  // Enter / leave speaker mode → suspend or restore personal PlayerState
  useEffect(() => {
    if (isSpeaker && !wasSpeakerRef.current) {
      wasSpeakerRef.current = true;
      audio.suspendPersonalPersistence();
      suspendPersonalPlayerSnapshot(audio.getPersonalPlayerSnapshot(), audio.isPlayerVisible);
    } else if (!isSpeaker && wasSpeakerRef.current) {
      wasSpeakerRef.current = false;
      const suspended = takeSuspendedPersonalPlayer();
      audio.resumePersonalPersistence();
      void audio.restorePersonalPlayerSnapshot(
        suspended?.snapshot ?? {
          playContext: null,
          currentTrackId: null,
          upNextIds: [],
          shuffleSeed: null,
          loopMode: "off",
        },
        suspended?.wasVisible ?? false,
      );
    }
  }, [isSpeaker, audio]);

  // Host: replace the on-screen queue with the room queue, including an empty room.
  useEffect(() => {
    if (!isSpeaker || !room || !party) return;
    const { nowPlaying, upcoming } = splitRoomQueue(room);
    audio.syncRoomSpeakerQueue({
      roomId: room.id,
      code: room.code,
      nowPlaying: nowPlaying ? roomQueueItemToFullTrack(nowPlaying.track) : null,
      upcoming: upcoming.map((item) => roomQueueItemToFullTrack(item.track)),
      autoplay: room.playback.isPlaying,
      onEnded: () => {
        void party.transport({ action: "skip" });
      },
    });
  }, [isSpeaker, room, party, audio]);

  // Host: sync play/pause from room playback flag
  useEffect(() => {
    if (!isSpeaker || !room) return;
    audio.setRoomPlaybackPlaying(room.playback.isPlaying);
  }, [isSpeaker, room?.playback.isPlaying, room, audio]);

  if (!room || room.status !== "open") return null;

  // Non-host: read-only now-playing bar
  if (!isSpeaker) {
    const { nowPlaying } = splitRoomQueue(room);
    if (!nowPlaying) return null;
    return (
      <div
        className="fixed inset-x-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 md:bottom-0"
        style={{
          bottom:
            "calc(var(--bottom-bar-height, 64px) + var(--player-error-height, 0px) + env(safe-area-inset-bottom))",
        }}
        data-testid="room-now-playing-bar"
      >
        <Link
          to={`/rooms/${room.code}`}
          className="container flex items-center gap-3 py-2 text-sm hover:bg-muted/40"
        >
          <Icon name="speaker-wave" className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{nowPlaying.track.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {nowPlaying.track.artistName} · Room {room.code}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">View queue</span>
        </Link>
      </div>
    );
  }

  // Keep room play attribution module aware (used by AudioPlayer via context)
  void reportRoomPlayEvent;
  void lastPlayIdRef;

  return null;
}

function roomQueueItemToFullTrack(track: {
  id: string;
  title: string;
  artistName: string;
  duration: number | null;
  coverObjectKey: string | null;
}): FullTrack {
  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    artist: { id: "room-artist", name: track.artistName },
    coverImage: track.coverObjectKey ? { objectKey: track.coverObjectKey } : null,
    audioFiles: [{ id: `room-audio-${track.id}`, format: "mp3", objectKey: "room" }],
  };
}

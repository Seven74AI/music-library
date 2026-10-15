import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { roomStateAfterAutoplay } from "#app/components/audio-player-room-playback.ts";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { Icon } from "#app/components/ui/icon.tsx";
import { isCurrentHost, splitRoomQueue } from "#app/features/party-room/index.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import {
  suspendPersonalPlayerSnapshot,
  takeSuspendedPersonalPlayer,
} from "#app/features/party-room/player-suspend.ts";
import { type RoomSnapshot } from "#app/features/party-room/types.ts";
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
  const blockedAttemptRef = useRef<string | null>(null);
  const partyRef = useRef(party);
  partyRef.current = party;

  const room = party?.room ?? null;
  const isSpeaker = Boolean(room && room.status === "open" && isCurrentHost(room));
  const roomRef = useRef(room);
  roomRef.current = room;

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

  // Host: ask the media element to play only while this attempt has not been blocked.
  useEffect(() => {
    if (!isSpeaker || !room) return;
    if (!room.playback.isPlaying) {
      blockedAttemptRef.current = null;
      audio.setRoomPlaybackPlaying(false);
      return;
    }
    const attemptKey = roomPlayAttemptKey(room);
    if (blockedAttemptRef.current === attemptKey) {
      audio.setRoomPlaybackPlaying(false);
      return;
    }
    audio.setRoomPlaybackPlaying(true);
  }, [isSpeaker, room, audio]);

  // Blocked autoplay keeps the room paused. Started audio is reported by the
  // player itself; this bridge does not send a second play event.
  useEffect(() => {
    if (!isSpeaker) return;
    return audio.subscribeRoomAutoplay((outcome) => {
      const next = roomStateAfterAutoplay(outcome);
      const currentRoom = roomRef.current;
      const currentParty = partyRef.current;
      if (!currentRoom || !currentParty || next.reportPlaying) return;
      const attemptKey = roomPlayAttemptKey(currentRoom);
      if (blockedAttemptRef.current === attemptKey) return;
      blockedAttemptRef.current = attemptKey;
      audio.setRoomPlaybackPlaying(false);
      void currentParty.transport({ action: "pause" });
    });
  }, [isSpeaker, audio]);

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
            {speakerDisplayName(room) ? (
              <p className="truncate text-xs text-muted-foreground">
                {speakerDisplayName(room)} is the speaker
              </p>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">View queue</span>
        </Link>
      </div>
    );
  }

  return null;
}

function roomPlayAttemptKey(room: RoomSnapshot): string {
  return `${room.id}:${room.playback.currentTrackId ?? ""}:${room.playback.currentIndex}`;
}

function speakerDisplayName(room: RoomSnapshot): string | null {
  const participants = room.participants ?? [];
  const host =
    participants.find((participant) => participant.id === room.currentHostParticipantId) ??
    (room.me?.id === room.currentHostParticipantId ? room.me : null);
  const name = host?.displayName?.trim();
  return name ? name : null;
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

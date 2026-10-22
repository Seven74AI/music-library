import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { cn } from "#app/utils/misc.tsx";

/**
 * Persistent chip while the signed-in user is in an open Party Room.
 * Client navigation back to the room keeps the speaker's audio element alive.
 */
export function InRoomChip({ className }: { className?: string }) {
  const party = useOptionalPartyRoom();
  if (!party?.room || party.room.status !== "open") return null;

  const { room, isHost } = party;
  const roleLabel = isHost ? "host" : room.me?.role;
  return (
    <Link
      to={`/rooms/${room.code}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-primary/15",
        className,
      )}
      aria-label={roleLabel ? `In room ${room.code}, ${roleLabel}` : `In room ${room.code}`}
    >
      <Icon name="speaker-wave" className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="font-mono tracking-wider">{room.code}</span>
      {isHost ? (
        <span className="hidden rounded bg-primary/20 px-1 py-0.5 text-[10px] uppercase tracking-wide text-primary sm:inline">
          Host
        </span>
      ) : room.me ? (
        <span className="hidden text-muted-foreground capitalize sm:inline">{room.me.role}</span>
      ) : null}
    </Link>
  );
}

/** Compact leave control used next to the chip on room pages. */
export function LeaveRoomButton() {
  const party = useOptionalPartyRoom();
  if (!party?.room) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void party.leave().catch(() => {});
      }}
    >
      Leave
    </Button>
  );
}

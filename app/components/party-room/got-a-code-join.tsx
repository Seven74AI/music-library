import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { parseRoomCodeInput } from "#app/features/party-room/code.ts";
import { ROOM_ROLE, type RoomRole } from "#app/features/party-room/constants.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";

function roomRoleLabel(role: RoomRole): string {
  if (role === ROOM_ROLE.host) return "Host";
  if (role === ROOM_ROLE.dj) return "DJ";
  return "Listener";
}

/**
 * Home affordance: join a Party Room by code or pasted link.
 */
export function GotACodeJoin({ className }: { className?: string }) {
  const party = useOptionalPartyRoom();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!party) return null;
  if (party.room?.status === "open") {
    const role = party.room.me?.role;
    return (
      <section className={className}>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <Icon name="speaker-wave" className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">You&apos;re in room {party.room.code}</p>
            {role ? <p className="text-sm text-muted-foreground">{roomRoleLabel(role)}</p> : null}
            <p className="text-sm text-muted-foreground">Open the room to see the shared queue.</p>
          </div>
          <Button asChild size="sm">
            <Link to={`/rooms/${party.room.code}`}>Open room</Link>
          </Button>
        </div>
      </section>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const code = parseRoomCodeInput(value);
    if (!code) {
      setLocalError("Enter a valid 6-character code or join link");
      return;
    }
    setBusy(true);
    try {
      const room = await party.join(code);
      void navigate(`/rooms/${room.code}`);
    } catch {
      setLocalError(party.error ?? "Could not join room");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={className}>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="rounded-lg border border-border bg-muted/30 px-4 py-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon name="question-mark-circled" className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Got a code?</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Join a Party Room with a 6-character code or paste the invite link.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="AB3K9Q or https://…/rooms/…"
            aria-label="Room code or join link"
            className="font-mono uppercase sm:flex-1"
            autoComplete="off"
            maxLength={200}
          />
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? "Joining…" : "Join room"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/rooms">Create room</Link>
          </Button>
        </div>
        {(localError || party.error) && !party.apiUnavailable ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {localError ?? party.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

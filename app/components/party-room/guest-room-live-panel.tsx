/**
 * Guest Shell Room tab — live queue (SSE via PartyRoomProvider), DJ edit,
 * Become host, leave, or end the room when this seat is Host.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router";
import { EndRoomButton } from "#app/components/party-room/end-room-button.tsx";
import { HostFailoverControls } from "#app/components/party-room/host-failover-controls.tsx";
import { RoomQueuePanel } from "#app/components/party-room/room-queue-panel.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { writeActiveRoomCode } from "#app/features/party-room/api.client.ts";
import { canAddTracks } from "#app/features/party-room/capabilities.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { ROOM_ROLE, roomRoleLabel, type RoomRole } from "#app/features/party-room/constants.ts";

/** @deprecated Use {@link roomRoleLabel} from `#app/features/party-room/constants.ts`. */
export const formatRoomRole = roomRoleLabel;

/**
 * Host seats and linked members keep "Signed in as".
 * A logged-out guest joined with a display name and is not signed in.
 */
function seatUsesSignedInCopy(
  seatRole: RoomRole,
  me: { isGuest?: boolean; userId?: string | null } | null | undefined,
): boolean {
  if (seatRole === ROOM_ROLE.host) return true;
  if (!me) return false;
  if (me.isGuest === true) return false;
  if (me.isGuest === false) return true;
  return Boolean(me.userId);
}

export function GuestRoomLivePanel({
  code,
  role,
  displayName,
  onLeaveStart,
}: {
  code: string;
  role: RoomRole;
  displayName: string;
  onLeaveStart?: () => void;
}) {
  const party = useOptionalPartyRoom();
  const navigate = useNavigate();
  const refresh = party?.refresh;
  const liveRole = party?.room?.code === code ? party.room.me?.role : undefined;
  const seatRole = liveRole ?? role;
  const canAdd = canAddTracks(seatRole);
  const isHostSeat = seatRole === ROOM_ROLE.host;
  const liveMe = party?.room?.code === code ? party.room.me : undefined;
  const shownName = liveMe?.displayName ?? displayName;
  const signedInCopy = seatUsesSignedInCopy(seatRole, liveMe);

  useEffect(() => {
    writeActiveRoomCode(code);
    void refresh?.();
  }, [code, refresh]);

  return (
    <div className="space-y-6">
      <HostFailoverControls />

      {party?.loading && !party.room ? (
        <p className="text-sm text-muted-foreground">Syncing room…</p>
      ) : null}

      {party?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {party.error}
        </p>
      ) : null}

      <RoomQueuePanel />

      {!party?.room && !party?.loading ? (
        <p className="text-sm text-muted-foreground">
          {canAdd
            ? "You can add tracks from Search. Queue updates live once connected."
            : "Search & audition only until a DJ/Host promotes you."}
        </p>
      ) : null}

      <section className="space-y-3 border-t border-border/60 pt-4 text-sm text-muted-foreground">
        <p>
          {signedInCopy ? "Signed in as" : "Joined as a guest"}{" "}
          <span className="text-foreground">{shownName}</span> (
          <span>{formatRoomRole(seatRole)}</span>)
        </p>
        <p>
          Room <span className="font-mono text-foreground">{code}</span>
        </p>
        {isHostSeat ? (
          <EndRoomButton
            onConfirm={() => {
              void (async () => {
                try {
                  if (!party) {
                    throw new Error("Not in a room");
                  }
                  await party.end();
                  toast({ title: "Room ended" });
                  void navigate("/");
                } catch (err: unknown) {
                  toast({
                    title: "Could not end room",
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                }
              })();
            }}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  onLeaveStart?.();
                  if (party) {
                    await party.leave(code);
                  } else {
                    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/leave`, {
                      method: "POST",
                      credentials: "same-origin",
                    });
                    if (!res.ok) {
                      const body = (await res.json().catch(() => null)) as {
                        error?: string;
                      } | null;
                      throw new Error(body?.error ?? "Could not leave");
                    }
                    writeActiveRoomCode(null);
                  }
                  toast({ title: "Left room" });
                  void navigate("/");
                } catch (err: unknown) {
                  toast({
                    title: "Could not leave",
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                }
              })();
            }}
          >
            Leave room
          </Button>
        )}
      </section>
    </div>
  );
}

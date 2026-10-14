import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { AddPlaylistToRoom } from "#app/components/party-room/add-playlist-to-room.tsx";
import { EndRoomButton } from "#app/components/party-room/end-room-button.tsx";
import { HostFailoverControls } from "#app/components/party-room/host-failover-controls.tsx";
import { RoomQueuePanel } from "#app/components/party-room/room-queue-panel.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Label } from "#app/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { ROOM_ROLE, type RoomDefaultJoinRole } from "#app/features/party-room/constants.ts";
import { usePartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { isParticipantAway } from "#app/features/party-room/presence.ts";

/** Hard navigations avoid RR lazy-discovery crashes on stale post-deploy tabs. */
function goToRoom(code: string) {
  window.location.assign(`/rooms/${code}`);
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast({ title: "Copied" }),
    () => toast({ title: "Could not copy", variant: "destructive" }),
  );
}

export function RoomsHub() {
  const party = usePartyRoom();
  const [joinValue, setJoinValue] = useState("");
  const [defaultJoinRole, setDefaultJoinRole] = useState<RoomDefaultJoinRole>("listener");
  const [busy, setBusy] = useState(false);

  if (party.loading && !party.apiUnavailable) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <header>
          <h1 className="text-2xl font-bold">Party Room</h1>
          <p className="mt-1 text-sm text-muted-foreground">Loading your room…</p>
        </header>
      </div>
    );
  }

  if (party.room?.status === "open") {
    const room = party.room;
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">Current room</p>
          <h1 className="font-mono text-4xl font-bold tracking-[0.2em]">{room.code}</h1>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                copyText(room.joinUrl || `${window.location.origin}/rooms/${room.code}`)
              }
            >
              <Icon name="link-2" className="mr-1 h-4 w-4" />
              Copy link
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => copyText(room.code)}>
              Copy code
            </Button>
            {room.me?.role === ROOM_ROLE.host ? (
              <EndRoomButton
                onConfirm={() => {
                  void party.end().then(() => toast({ title: "Room ended" }));
                }}
              />
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void party.leave().then(() => toast({ title: "Left room" }));
                }}
              >
                Leave
              </Button>
            )}
          </div>
          {room.qrDataUrl ? (
            <img
              src={room.qrDataUrl}
              alt={`QR code to join room ${room.code}`}
              className="mt-3 h-40 w-40 rounded-md border border-border bg-white p-2"
            />
          ) : null}
        </header>

        <HostFailoverControls />

        {party.canManage ? (
          <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="default-join-role">Default join role</Label>
            <Select
              value={room.defaultJoinRole}
              onValueChange={(v) => {
                void party.setDefaultJoinRole(v as RoomDefaultJoinRole);
              }}
            >
              <SelectTrigger id="default-join-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="listener">Listener</SelectItem>
                <SelectItem value="dj">DJ</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Participants ({room.participants?.length ?? 0})
          </h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {(room.participants ?? []).map((p) => {
              const isSelf = p.id === room.me?.id;
              const canManageParticipant = party.canManage && !isSelf && p.role !== "host";
              const away = isParticipantAway(
                p.lastHeartbeatAt,
                p.id === room.currentHostParticipantId,
              );
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {p.displayName}
                    {isSelf ? " (you)" : ""}
                    {away ? <span className="text-muted-foreground"> · Away</span> : null}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="capitalize text-muted-foreground">{p.role}</span>
                    {canManageParticipant ? (
                      <>
                        {p.role !== "dj" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void party
                                .setRole(p.id, "dj")
                                .then(() => toast({ title: `${p.displayName} is now a DJ` }))
                                .catch((err: unknown) =>
                                  toast({
                                    title: "Could not change role",
                                    description: err instanceof Error ? err.message : undefined,
                                    variant: "destructive",
                                  }),
                                );
                            }}
                          >
                            Make DJ
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void party
                                .setRole(p.id, "listener")
                                .then(() => toast({ title: `${p.displayName} is now a Listener` }))
                                .catch((err: unknown) =>
                                  toast({
                                    title: "Could not change role",
                                    description: err instanceof Error ? err.message : undefined,
                                    variant: "destructive",
                                  }),
                                );
                            }}
                          >
                            Make Listener
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void party
                              .kick(p.id)
                              .then(() => toast({ title: `${p.displayName} removed` }))
                              .catch((err: unknown) =>
                                toast({
                                  title: "Could not kick",
                                  description: err instanceof Error ? err.message : undefined,
                                  variant: "destructive",
                                }),
                              );
                          }}
                        >
                          Kick
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {party.canManage ? <AddPlaylistToRoom /> : null}

        <RoomQueuePanel />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Party Room</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share one speaker and a live queue. Create a room or join with a code.
        </p>
      </header>

      {party.apiUnavailable ? (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          role="status"
        >
          Party Room APIs are not deployed yet (backend issues #286–#288). UI is ready and will
          connect when those land.
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="font-semibold">Create a room</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="create-default-role">Walk-ups join as</Label>
          <Select
            value={defaultJoinRole}
            onValueChange={(v) => setDefaultJoinRole(v as RoomDefaultJoinRole)}
          >
            <SelectTrigger id="create-default-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="listener">Listener</SelectItem>
              <SelectItem value="dj">DJ</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          disabled={busy || party.apiUnavailable}
          onClick={() => {
            setBusy(true);
            void party
              .create(defaultJoinRole)
              .then((room) => {
                toast({ title: "Room created", description: room.code });
                goToRoom(room.code);
              })
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          <Icon name="plus" className="mr-1 h-4 w-4" />
          {busy ? "Creating…" : "Create room"}
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="font-semibold">Join with a code</h2>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            void party
              .join(joinValue)
              .then((room) => {
                goToRoom(room.code);
              })
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          <Input
            value={joinValue}
            onChange={(e) => setJoinValue(e.target.value)}
            placeholder="AB3K9Q"
            className="font-mono uppercase"
            aria-label="Room code"
          />
          <Button type="submit" disabled={busy || !joinValue.trim() || party.apiUnavailable}>
            Join
          </Button>
        </form>
        {party.error && !party.apiUnavailable ? (
          <p className="text-sm text-destructive" role="alert">
            {party.error}
          </p>
        ) : null}
      </section>

      <p className="text-sm text-muted-foreground">
        <Link to="/" className="underline">
          Back home
        </Link>
      </p>
    </div>
  );
}

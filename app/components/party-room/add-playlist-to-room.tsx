import { useEffect, useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";

type PlaylistOption = {
  id: string;
  title: string;
  _count: { tracks: number };
};

/**
 * Host-only: bulk-append a personal playlist onto the room queue (ADR-030).
 */
export function AddPlaylistToRoom() {
  const party = useOptionalPartyRoom();
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [playlistId, setPlaylistId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const canAdd = Boolean(party?.canManage && party.room?.status === "open");

  useEffect(() => {
    if (!canAdd) return;
    let cancelled = false;
    setLoading(true);
    void fetch("/resources/playlists", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load playlists");
        const body = (await res.json()) as { playlists?: PlaylistOption[] };
        if (!cancelled) {
          setPlaylists(body.playlists ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setPlaylists([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAdd]);

  if (!canAdd || !party) return null;

  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">Add playlist to queue</h3>
      <p className="text-xs text-muted-foreground">
        Append tracks with audio from one of your playlists (Host only).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={playlistId}
          onValueChange={setPlaylistId}
          disabled={loading || playlists.length === 0}
        >
          <SelectTrigger aria-label="Playlist to add" className="sm:max-w-xs">
            <SelectValue placeholder={loading ? "Loading…" : "Choose a playlist"} />
          </SelectTrigger>
          <SelectContent>
            {playlists.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title} ({p._count.tracks})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={busy || !playlistId}
          onClick={() => {
            setBusy(true);
            void party
              .addPlaylist(playlistId)
              .then(() => {
                toast({ title: "Playlist added to room queue" });
                setPlaylistId("");
              })
              .catch((err: unknown) => {
                toast({
                  title: "Could not add playlist",
                  description: err instanceof Error ? err.message : undefined,
                  variant: "destructive",
                });
              })
              .finally(() => setBusy(false));
          }}
        >
          <Icon name="plus" className="mr-1 h-4 w-4" />
          {busy ? "Adding…" : "Add to queue"}
        </Button>
      </div>
      {!loading && playlists.length === 0 ? (
        <p className="text-xs text-muted-foreground">No personal playlists yet.</p>
      ) : null}
    </section>
  );
}

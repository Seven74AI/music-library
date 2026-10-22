import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#app/components/ui/dialog.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { ScrollArea } from "#app/components/ui/scroll-area.tsx";

type Playlist = {
  id: string;
  title: string;
  description: string | null;
  _count: { tracks: number };
};

type PromoteResponse = {
  status: string;
  message?: string;
  addedCount?: number;
  skippedCount?: number;
  playlist?: { id: string; title: string };
  existingTitle?: string;
};

type PromoteSnapshotDialogProps = {
  snapshotId: string;
  snapshotLabel: string;
};

/**
 * Promote Snapshot — copy all snapshot tracks into a new or existing UserPlaylist.
 */
export function PromoteSnapshotDialog({ snapshotId, snapshotLabel }: PromoteSnapshotDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "create" | "add">("menu");
  const [newTitle, setNewTitle] = useState(snapshotLabel);
  const [createError, setCreateError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // The on-repeat route keeps one dialog mounted and swaps snapshotId.
  const [appliedSnapshotId, setAppliedSnapshotId] = useState(snapshotId);
  if (appliedSnapshotId !== snapshotId) {
    setAppliedSnapshotId(snapshotId);
    setOpen(false);
    setMode("menu");
    setNewTitle(snapshotLabel);
    setCreateError(null);
    setSearchQuery("");
  }

  const promoteFetcher = useFetcher<PromoteResponse>();
  const playlistsFetcher = useFetcher<{ playlists: Playlist[] }>();
  const submittedSnapshotId = useRef<string | null>(null);
  const handledPromoteData = useRef<unknown>(null);

  const resetState = useCallback(() => {
    setMode("menu");
    setNewTitle(snapshotLabel);
    setCreateError(null);
    setSearchQuery("");
  }, [snapshotLabel]);

  useEffect(() => {
    if (mode === "add" && playlistsFetcher.state === "idle" && !playlistsFetcher.data) {
      playlistsFetcher.load("/resources/playlists");
    }
  }, [mode, playlistsFetcher]);

  const playlists = playlistsFetcher.data?.playlists;

  const filteredPlaylists = useMemo(() => {
    const list = playlists ?? [];
    if (!searchQuery) return list;
    return list.filter((p) => p.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [playlists, searchQuery]);

  useEffect(() => {
    if (promoteFetcher.state !== "idle" || !promoteFetcher.data) return;
    if (handledPromoteData.current === promoteFetcher.data) return;
    // A response for the previous snapshot must not close or error the next one.
    if (submittedSnapshotId.current !== snapshotId) return;
    handledPromoteData.current = promoteFetcher.data;
    if (promoteFetcher.data.status === "success") {
      setOpen(false);
      resetState();
    } else if (promoteFetcher.data.status === "duplicate_title") {
      setCreateError(
        promoteFetcher.data.message ??
          `You already have a playlist named "${promoteFetcher.data.existingTitle ?? ""}"`,
      );
    }
  }, [promoteFetcher.state, promoteFetcher.data, resetState, snapshotId]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) resetState();
    },
    [resetState],
  );

  const handleCreate = useCallback(() => {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setCreateError("Playlist name is required");
      return;
    }
    setCreateError(null);
    submittedSnapshotId.current = snapshotId;
    void promoteFetcher.submit(
      { snapshotId, action: "create", title: trimmed },
      { method: "POST", action: "/resources/promote-on-repeat-snapshot" },
    );
  }, [promoteFetcher, newTitle, snapshotId]);

  const handleAdd = useCallback(
    (targetId: string) => {
      submittedSnapshotId.current = snapshotId;
      void promoteFetcher.submit(
        { snapshotId, action: "add", targetPlaylistId: targetId },
        { method: "POST", action: "/resources/promote-on-repeat-snapshot" },
      );
    },
    [promoteFetcher, snapshotId],
  );

  const isBusy = promoteFetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon name="plus" className="mr-2 h-4 w-4" />
          Promote to playlist
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm">
        {mode === "menu" ? (
          <>
            <DialogHeader>
              <DialogTitle>Promote snapshot</DialogTitle>
              <DialogDescription>
                Copy tracks from "{snapshotLabel}" into a user playlist. The snapshot stays
                read-only.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex flex-col gap-2">
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => setMode("create")}
                disabled={isBusy}
              >
                <Icon name="plus" className="mr-2 h-4 w-4" />
                Create new playlist
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => setMode("add")}
                disabled={isBusy}
              >
                <Icon name="update" className="mr-2 h-4 w-4" />
                Add to existing playlist
              </Button>
            </div>
          </>
        ) : null}

        {mode === "create" ? (
          <>
            <DialogHeader>
              <DialogTitle>Create new playlist</DialogTitle>
              <DialogDescription>
                All tracks from "{snapshotLabel}" will be added to the new playlist.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-3">
              <Input
                id="promote-playlist-title"
                placeholder="Playlist name"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                autoFocus
                disabled={isBusy}
                aria-invalid={!!createError}
              />
              {createError ? (
                <p className="text-xs text-destructive" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={isBusy} className="flex-1">
                  {isBusy ? "Creating…" : "Create playlist"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMode("menu");
                    setCreateError(null);
                  }}
                  disabled={isBusy}
                >
                  Back
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {mode === "add" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add to existing playlist</DialogTitle>
              <DialogDescription>
                Duplicates are skipped. The On-Repeat snapshot is unchanged.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-3">
              <Input
                placeholder="Search playlists…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                disabled={isBusy}
              />
              <ScrollArea className="h-48">
                {playlistsFetcher.state === "loading" ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Loading playlists…
                  </div>
                ) : filteredPlaylists.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {searchQuery ? "No playlists found" : "No playlists yet"}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredPlaylists.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => handleAdd(playlist.id)}
                        disabled={isBusy}
                        className="w-full rounded px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <div className="text-sm font-medium">{playlist.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {playlist._count.tracks}{" "}
                          {playlist._count.tracks === 1 ? "track" : "tracks"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
              <Button variant="outline" onClick={() => setMode("menu")} disabled={isBusy}>
                Back
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

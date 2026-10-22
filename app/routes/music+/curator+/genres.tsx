import { Link, useLoaderData, useFetcher } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { useEffect, useRef, useState } from "react";
import { Button } from "#app/components/ui/button";
import { Card, CardContent } from "#app/components/ui/card";
import { Icon } from "#app/components/ui/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#app/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "#app/components/ui/dialog";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select";
import { Checkbox } from "#app/components/ui/checkbox";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { type Route } from "./+types/genres";

type Genre = {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
};

function actionError(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const error = (data as { error: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

function isGenreSaved(data: unknown): boolean {
  if (actionError(data)) return false;
  if (!data || typeof data !== "object" || !("genre" in data)) return false;
  return (data as { genre: unknown }).genre != null;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorOrAdmin(request);

  // Fetch genres from API
  const response = await fetch(new URL("/api/genres", request.url));
  const result = (await response.json()) as { genres: Genre[] };

  return { genres: result.genres };
}

export default function GenresPage() {
  const { genres } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher();
  const editFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const mergeFetcher = useFetcher();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const [newGenreName, setNewGenreName] = useState("");
  const [editingGenre, setEditingGenre] = useState<Genre | null>(null);
  const [editedName, setEditedName] = useState("");
  const [deletingGenre, setDeletingGenre] = useState<Genre | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [mergeTargetId, setMergeTargetId] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const seenCreateData = useRef<unknown>(undefined);
  const seenEditData = useRef<unknown>(undefined);

  useEffect(() => {
    if (createFetcher.state !== "idle" || createFetcher.data == null) return;
    if (seenCreateData.current === createFetcher.data) return;
    seenCreateData.current = createFetcher.data;

    const message = actionError(createFetcher.data);
    if (message) {
      setCreateError(message);
      return;
    }

    if (isGenreSaved(createFetcher.data)) {
      setCreateError(null);
      setNewGenreName("");
      setCreateDialogOpen(false);
    }
  }, [createFetcher.state, createFetcher.data]);

  useEffect(() => {
    if (editFetcher.state !== "idle" || editFetcher.data == null) return;
    if (seenEditData.current === editFetcher.data) return;
    seenEditData.current = editFetcher.data;

    const message = actionError(editFetcher.data);
    if (message) {
      setEditError(message);
      return;
    }

    if (isGenreSaved(editFetcher.data)) {
      setEditError(null);
      setEditingGenre(null);
      setEditedName("");
      setEditDialogOpen(false);
    }
  }, [editFetcher.state, editFetcher.data]);

  // Filter genres by search query
  const filteredGenres = genres.filter((genre) =>
    genre.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleCreate = () => {
    if (!newGenreName.trim() || createFetcher.state !== "idle") return;

    setCreateError(null);
    createFetcher.submit(
      { name: newGenreName },
      {
        method: "POST",
        action: "/api/genres",
        encType: "application/json",
      },
    );
  };

  const handleEdit = () => {
    if (!editingGenre || !editedName.trim() || editFetcher.state !== "idle") return;

    setEditError(null);
    editFetcher.submit(
      { name: editedName },
      {
        method: "PUT",
        action: `/api/genres/${editingGenre.id}`,
        encType: "application/json",
      },
    );
  };

  const handleDelete = () => {
    if (!deletingGenre) return;

    deleteFetcher.submit(
      {},
      {
        method: "DELETE",
        action: `/api/genres/${deletingGenre.id}`,
      },
    );

    setDeletingGenre(null);
    setDeleteDialogOpen(false);
  };

  const handleMerge = () => {
    if (selectedGenres.size < 2 || !mergeTargetId) return;

    const sourceIds = Array.from(selectedGenres).filter((id) => id !== mergeTargetId);

    mergeFetcher.submit(
      {
        sourceIds,
        targetId: mergeTargetId,
      },
      {
        method: "POST",
        action: "/api/genres/merge",
        encType: "application/json",
      },
    );

    setSelectedGenres(new Set());
    setMergeTargetId("");
    setMergeDialogOpen(false);
  };

  const openEditDialog = (genre: Genre) => {
    setEditingGenre(genre);
    setEditedName(genre.name);
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (genre: Genre) => {
    setDeletingGenre(genre);
    setDeleteDialogOpen(true);
  };

  const openMergeDialog = () => {
    if (selectedGenres.size < 2) return;
    setMergeDialogOpen(true);
  };

  const toggleGenreSelection = (genreId: string) => {
    const newSelection = new Set(selectedGenres);
    if (newSelection.has(genreId)) {
      newSelection.delete(genreId);
    } else {
      newSelection.add(genreId);
    }
    setSelectedGenres(newSelection);
  };

  return (
    <div className="container mx-auto max-w-6xl overflow-x-hidden px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Genre Management</h1>
        <p className="text-muted-foreground">
          Manage music genres, merge duplicates, and keep your library organized
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="relative">
            <Icon
              name="magnifying-glass"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder="Search genres..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button className="min-h-11" onClick={() => setCreateDialogOpen(true)}>
          <Icon name="plus" className="mr-2 h-4 w-4" />
          Add Genre
        </Button>
        <Button
          className="min-h-11"
          onClick={openMergeDialog}
          disabled={selectedGenres.size < 2}
          variant="outline"
        >
          <Icon name="arrow-path" className="mr-2 h-4 w-4" />
          Merge Selected ({selectedGenres.size})
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={
                          selectedGenres.size === filteredGenres.length && filteredGenres.length > 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGenres(new Set(filteredGenres.map((g) => g.id)));
                          } else {
                            setSelectedGenres(new Set());
                          }
                        }}
                      />
                    </div>
                  </TableHead>
                  <TableHead>Genre Name</TableHead>
                  <TableHead className="text-right">Track Count</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGenres.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      {searchQuery
                        ? "No genres match your search"
                        : "No genres yet. Create one to get started."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGenres.map((genre) => (
                    <TableRow key={genre.id}>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={selectedGenres.has(genre.id)}
                            onCheckedChange={() => toggleGenreSelection(genre.id)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/library?genre=${encodeURIComponent(genre.id)}`}
                          className="font-medium hover:underline text-left"
                        >
                          {genre.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {genre.trackCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            className="min-h-11 min-w-11"
                            aria-label={`Edit ${genre.name}`}
                            onClick={() => openEditDialog(genre)}
                          >
                            <Icon name="pencil-1" className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-11 min-w-11"
                            aria-label={`Delete ${genre.name}`}
                            onClick={() => openDeleteDialog(genre)}
                          >
                            <Icon name="trash" className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create Genre Dialog */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateError(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Genre</DialogTitle>
            <DialogDescription>Add a new genre to your music library</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="genre-name">Genre Name</Label>
              <Input
                id="genre-name"
                value={newGenreName}
                onChange={(e) => {
                  setNewGenreName(e.target.value);
                  setCreateError(null);
                }}
                placeholder="e.g., Progressive Rock"
                aria-invalid={createError ? true : undefined}
                aria-describedby={createError ? "genre-name-error" : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
              {createError ? (
                <p id="genre-name-error" className="text-sm text-destructive" role="alert">
                  {createError}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newGenreName.trim() || createFetcher.state !== "idle"}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Genre Dialog */}
      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) setEditError(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Genre</DialogTitle>
            <DialogDescription>Rename this genre (affects all linked tracks)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-genre-name">Genre Name</Label>
              <Input
                id="edit-genre-name"
                value={editedName}
                onChange={(e) => {
                  setEditedName(e.target.value);
                  setEditError(null);
                }}
                placeholder="e.g., Progressive Rock"
                aria-invalid={editError ? true : undefined}
                aria-describedby={editError ? "edit-genre-name-error" : undefined}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleEdit();
                  }
                }}
              />
              {editError ? (
                <p id="edit-genre-name-error" className="text-sm text-destructive" role="alert">
                  {editError}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={!editedName.trim() || editFetcher.state !== "idle"}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Genre Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Genre</DialogTitle>
            <DialogDescription>Are you sure you want to delete this genre?</DialogDescription>
          </DialogHeader>
          {deletingGenre && (
            <div className="py-4">
              <p className="mb-2">
                This will remove <strong>{deletingGenre.name}</strong> from{" "}
                <strong>{deletingGenre.trackCount}</strong> track(s).
              </p>
              <p className="text-sm text-muted-foreground">
                Tracks will not be deleted, only the genre tag will be removed.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Genre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Genres Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Merge Genres</DialogTitle>
            <DialogDescription>
              Combine multiple genres into one. All tracks will be relinked to the target genre.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Selected Genres ({selectedGenres.size})</Label>
              <div className="text-sm text-muted-foreground">
                {Array.from(selectedGenres)
                  .map((id) => genres.find((g) => g.id === id)?.name)
                  .filter(Boolean)
                  .join(", ")}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-target">Merge Into (Target)</Label>
              <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                <SelectTrigger id="merge-target">
                  <SelectValue placeholder="Select target genre..." />
                </SelectTrigger>
                {/* DialogContent is z-53. The shared select menu is z-50 and renders under it. */}
                <SelectContent className="z-[70]">
                  {Array.from(selectedGenres)
                    .map((id) => genres.find((g) => g.id === id))
                    .filter((genre): genre is Genre => genre !== undefined)
                    .map((genre) => (
                      <SelectItem key={genre.id} value={genre.id}>
                        {genre.name} ({genre.trackCount} tracks)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Other selected genres will be deleted after merging
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={!mergeTargetId}>
              Merge Genres
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { AlbumAutocomplete } from "#app/components/album-autocomplete";
import { ArtistAutocomplete } from "#app/components/artist-autocomplete";
import { GenreSelector, type Genre } from "#app/components/genre-selector";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Textarea } from "#app/components/ui/textarea";
import { toast } from "#app/components/ui/use-toast.ts";

interface BulkEditDialogProps {
  trackIds: string[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface BulkEditFormData {
  artistId: string | null;
  artistName: string;
  albumId: string | null;
  albumName: string;
  genres: Genre[];
  year: string;
  albumArtist: string;
  trackNumber: string;
  bpm: string;
  label: string;
  comment: string;
}

const emptyForm: BulkEditFormData = {
  artistId: null,
  artistName: "",
  albumId: null,
  albumName: "",
  genres: [],
  year: "",
  albumArtist: "",
  trackNumber: "",
  bpm: "",
  label: "",
  comment: "",
};

interface BulkEditResponse {
  success?: boolean;
  updated?: number;
  updatedCount?: number;
  error?: string;
  errors?: Array<{ trackId: string; error: string }>;
}

export function BulkEditDialog({ trackIds, open, onClose, onSuccess }: BulkEditDialogProps) {
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [formData, setFormData] = useState<BulkEditFormData>(emptyForm);

  const fetcher = useFetcher<BulkEditResponse>();
  const isSubmitting = fetcher.state !== "idle";

  const handleArtistChange = (id: string | null, name: string) => {
    setFormData((prev) => ({ ...prev, artistId: id, artistName: name }));
  };

  const handleAlbumChange = (id: string | null, name: string) => {
    setFormData((prev) => ({ ...prev, albumId: id, albumName: name }));
  };

  const handleCreateArtist = async (name: string) => {
    try {
      const response = await fetch("/api/artists/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || "Failed to create artist");
      }

      const data = (await response.json()) as { artist: { id: string; name: string } };
      handleArtistChange(data.artist.id, data.artist.name);
    } catch (error) {
      console.error("Error creating artist:", error);
      throw error;
    }
  };

  const handleCreateGenre = async (name: string): Promise<Genre> => {
    const response = await fetch("/api/genres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      throw new Error(errorData.error || "Failed to create genre");
    }

    const data = (await response.json()) as {
      genre: { id: string; name: string; trackCount: number };
    };
    return data.genre;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.comment.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason for the bulk edit",
        variant: "destructive",
      });
      return;
    }

    // Build changes object - only include non-empty fields
    const changes: Record<string, any> = {};
    if (formData.artistId) changes.artistId = formData.artistId;
    if (formData.albumId) changes.albumId = formData.albumId;
    if (formData.genres.length > 0) {
      changes.genreIds = formData.genres.map((genre) => genre.id);
    }
    if (formData.year.trim()) {
      const yearNum = parseInt(formData.year, 10);
      if (!isNaN(yearNum)) changes.year = yearNum;
    }
    if (formData.albumArtist.trim()) changes.albumArtist = formData.albumArtist.trim();
    if (formData.trackNumber.trim()) {
      const trackNum = parseInt(formData.trackNumber, 10);
      if (!isNaN(trackNum)) changes.trackNumber = trackNum;
    }
    if (formData.bpm.trim()) {
      const bpmNum = parseInt(formData.bpm, 10);
      if (!isNaN(bpmNum)) changes.bpm = bpmNum;
    }
    if (formData.label.trim()) changes.label = formData.label.trim();

    if (Object.keys(changes).length === 0) {
      toast({
        title: "Error",
        description: "Please specify at least one field to update",
        variant: "destructive",
      });
      return;
    }

    fetcher.submit(
      {
        trackIds,
        changes,
        comment: formData.comment,
      },
      {
        method: "POST",
        action: "/api/metadata/tracks/bulk-edit",
        encType: "application/json",
      },
    );
  };

  const handledResponseRef = useRef<BulkEditResponse | undefined>(undefined);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handledResponseRef.current === fetcher.data) return;
    handledResponseRef.current = fetcher.data;

    if (fetcher.data.success) {
      const updated = fetcher.data.updatedCount ?? fetcher.data.updated ?? 0;
      toast({
        title: "Success",
        description: `${updated} track(s) updated successfully`,
        variant: "success",
      });
      onSuccess();
      onClose();
      setFormData(emptyForm);
      return;
    }

    if (fetcher.data.errors) {
      const errorCount = fetcher.data.errors.length;
      const successCount = fetcher.data.updatedCount ?? fetcher.data.updated ?? 0;
      toast({
        title: "Partial Success",
        description: `${successCount} track(s) updated, ${errorCount} failed`,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Error",
      description: fetcher.data.error ?? "Bulk edit failed",
      variant: "destructive",
    });
  }, [fetcher.state, fetcher.data, onSuccess, onClose]);

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Edit - {trackIds.length} tracks selected</DialogTitle>
          <DialogDescription>⚠️ Changes will apply to all selected tracks</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-4 border-t pt-4">
            <p className="text-sm font-medium">Fields to Update</p>
            <p className="text-xs text-muted-foreground">Leave blank to keep existing values</p>

            <ArtistAutocomplete
              value={formData.artistId}
              artistName={formData.artistId ? formData.artistName : null}
              onChange={handleArtistChange}
              onCreateNew={handleCreateArtist}
              label="Artist"
              disabled={isSubmitting}
            />

            <div>
              <AlbumAutocomplete
                value={formData.albumId}
                albumName={formData.albumId ? formData.albumName : null}
                onChange={handleAlbumChange}
                label="Album"
                placeholder="Leave blank to keep existing"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Choose an existing album. Leave blank to keep each track's current album.
              </p>
            </div>

            <GenreSelector
              selectedGenres={formData.genres}
              onChange={(genres) => setFormData((prev) => ({ ...prev, genres }))}
              onCreateNew={handleCreateGenre}
              label="Genres"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Replaces genres on every selected track. Leave empty to keep existing genres.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  value={formData.year}
                  onChange={(e) => setFormData((prev) => ({ ...prev, year: e.target.value }))}
                  placeholder="Leave blank to keep existing"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {showMoreFields && (
              <>
                <div>
                  <Label htmlFor="albumArtist">Album Artist</Label>
                  <Input
                    id="albumArtist"
                    value={formData.albumArtist}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, albumArtist: e.target.value }))
                    }
                    placeholder="Leave blank to keep existing"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="trackNumber">Track Number</Label>
                    <Input
                      id="trackNumber"
                      type="number"
                      value={formData.trackNumber}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, trackNumber: e.target.value }))
                      }
                      placeholder="Leave blank"
                      min="1"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div>
                    <Label htmlFor="bpm">BPM</Label>
                    <Input
                      id="bpm"
                      type="number"
                      value={formData.bpm}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bpm: e.target.value }))}
                      placeholder="Leave blank"
                      min="1"
                      max="300"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div>
                    <Label htmlFor="label">Label</Label>
                    <Input
                      id="label"
                      value={formData.label}
                      onChange={(e) => setFormData((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="Leave blank"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowMoreFields(!showMoreFields)}
              className="w-full"
            >
              <Icon
                name={showMoreFields ? "chevron-up" : "chevron-down"}
                className="h-4 w-4 mr-2"
              />
              {showMoreFields ? "Show Fewer Fields" : "Show More Fields"}
            </Button>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="comment">
              Bulk Edit Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="comment"
              value={formData.comment}
              onChange={(e) => setFormData((prev) => ({ ...prev, comment: e.target.value }))}
              placeholder="Why are you making these changes?"
              required
              disabled={isSubmitting}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Required for audit trail</p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Icon name="update" className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                `Apply to ${trackIds.length} Track${trackIds.length === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

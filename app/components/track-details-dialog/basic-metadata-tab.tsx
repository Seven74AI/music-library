import { useEffect, useState } from "react";
import { AlbumAutocomplete } from "#app/components/album-autocomplete";
import { ArtistAutocomplete } from "#app/components/artist-autocomplete";
import { GenreSelector, type Genre } from "#app/components/genre-selector";
import { Button } from "#app/components/ui/button";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { type TrackDetails } from "../track-details-dialog";

interface BasicMetadataTabProps {
  track: TrackDetails;
  onSave: (changes: any) => void;
  disabled?: boolean;
  initialDraft?: Record<string, unknown> | null;
  onDraftChange?: (draft: Record<string, unknown> | null) => void;
}

function draftString(draft: Record<string, unknown> | null | undefined, key: string) {
  const value = draft?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Missing key stays undefined so the track's current album is kept. */
function draftAlbumId(draft: Record<string, unknown> | null | undefined) {
  if (!draft || !("albumId" in draft)) return undefined;
  const value = draft.albumId;
  if (value === null || value === "") return null;
  return typeof value === "string" ? value : undefined;
}

export function BasicMetadataTab({
  track,
  onSave,
  disabled = false,
  initialDraft = null,
  onDraftChange,
}: BasicMetadataTabProps) {
  const [title, setTitle] = useState(draftString(initialDraft, "title") ?? track.title);
  const [artistId, setArtistId] = useState(
    draftString(initialDraft, "artistId") ?? track.artist.id,
  );
  const [artistName, setArtistName] = useState(
    draftString(initialDraft, "artistName") ?? track.artist.name,
  );
  const draftedAlbumId = draftAlbumId(initialDraft);
  const [albumId, setAlbumId] = useState<string | null>(
    draftedAlbumId === undefined ? (track.albumRecord?.id ?? null) : draftedAlbumId,
  );
  const [albumName, setAlbumName] = useState(
    draftedAlbumId === undefined
      ? (track.albumRecord?.name ?? "")
      : (draftString(initialDraft, "albumName") ?? ""),
  );
  const [genres, setGenres] = useState<Genre[]>(track.genres.map((g) => ({ ...g, trackCount: 0 })));
  const [year, setYear] = useState(
    draftString(initialDraft, "year") ?? track.year?.toString() ?? "",
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleArtistChange = (id: string | null, name: string) => {
    setArtistId(id ?? "");
    setArtistName(name);
    if (errors.artist) {
      setErrors((prev) => ({ ...prev, artist: "" }));
    }
  };

  const handleAlbumChange = (id: string | null, name: string) => {
    setAlbumId(id);
    setAlbumName(name);
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
    try {
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
    } catch (error) {
      console.error("Error creating genre:", error);
      throw error;
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = "Title is required";
    }

    if (!artistId) {
      newErrors.artist = "Artist is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const changes = {
      title: title.trim(),
      artistId,
      albumId,
      genreIds: genres.map((g) => g.id),
      year: year ? parseInt(year, 10) : null,
    };

    onSave(changes);
  };

  const hasChanges =
    title !== track.title ||
    artistId !== track.artist.id ||
    albumId !== (track.albumRecord?.id ?? null) ||
    JSON.stringify(genres.map((g) => g.id).sort()) !==
      JSON.stringify(track.genres.map((g) => g.id).sort()) ||
    year !== (track.year?.toString() ?? "");

  useEffect(() => {
    if (!onDraftChange) return;
    if (!hasChanges) {
      onDraftChange(null);
      return;
    }
    onDraftChange({ title, artistId, artistName, albumId, albumName, year });
  }, [albumId, albumName, artistId, artistName, hasChanges, onDraftChange, title, year]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errors.title) {
              setErrors((prev) => ({ ...prev, title: "" }));
            }
          }}
          placeholder="Track title"
          aria-invalid={errors.title ? true : undefined}
          className={errors.title ? "border-input-invalid" : ""}
          disabled={disabled}
        />
        {errors.title && (
          <div className="px-4 pt-1 pb-3">
            <div className="text-[10px] text-destructive">{errors.title}</div>
          </div>
        )}
      </div>

      <ArtistAutocomplete
        value={artistId || null}
        artistName={artistId ? artistName : null}
        onChange={handleArtistChange}
        onCreateNew={handleCreateArtist}
        error={errors.artist}
        required
        disabled={disabled}
      />

      <div>
        <AlbumAutocomplete
          value={albumId}
          albumName={albumId ? albumName : null}
          onChange={handleAlbumChange}
          label="Album"
          disabled={disabled}
        />
        <p className="px-4 pt-1 text-[10px] text-muted-foreground">
          Choose an existing album. Clear the field to remove it.
        </p>
      </div>

      <GenreSelector
        selectedGenres={genres}
        onChange={setGenres}
        onCreateNew={handleCreateGenre}
        label="Genres"
        disabled={disabled}
      />

      <div>
        <Label htmlFor="year">Year</Label>
        <Input
          id="year"
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Release year"
          min="1900"
          max={new Date().getFullYear() + 1}
          disabled={disabled}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="submit" className="min-h-11" disabled={!hasChanges || disabled}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}

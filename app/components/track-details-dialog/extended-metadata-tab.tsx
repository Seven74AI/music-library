import { useState } from "react";
import { Button } from "#app/components/ui/button";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Textarea } from "#app/components/ui/textarea";
import { type TrackDetails } from "../track-details-dialog";

interface ExtendedMetadataTabProps {
  track: TrackDetails;
  onSave: (changes: any) => void;
  disabled?: boolean;
}

/** Date inputs need YYYY-MM-DD. Single-fetch revives Prisma dates as Date objects. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}

export function ExtendedMetadataTab({ track, onSave, disabled = false }: ExtendedMetadataTabProps) {
  const savedReleaseDate = toDateInputValue(track.releaseDate);
  const savedOriginalDate = toDateInputValue(track.originalDate);
  const [trackNumber, setTrackNumber] = useState(track.trackNumber?.toString() ?? "");
  const [albumArtist, setAlbumArtist] = useState(track.albumArtist ?? "");
  const [bpm, setBpm] = useState(track.bpm?.toString() ?? "");
  const [label, setLabel] = useState(track.label ?? "");
  const [isrc, setIsrc] = useState(track.isrc ?? "");
  const [releaseDate, setReleaseDate] = useState(savedReleaseDate);
  const [originalDate, setOriginalDate] = useState(savedOriginalDate);
  const [originalYear, setOriginalYear] = useState(track.originalYear?.toString() ?? "");
  const [totalTracks, setTotalTracks] = useState(track.totalTracks?.toString() ?? "");
  const [totalDiscs, setTotalDiscs] = useState(track.totalDiscs?.toString() ?? "");
  const [lyrics, setLyrics] = useState(track.lyrics ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const changes = {
      title: track.title,
      artistId: track.artist.id,
      albumId: track.albumRecord?.id ?? null,
      genre: track.genre,
      year: track.year,
      trackNumber: trackNumber ? parseInt(trackNumber, 10) : null,
      albumArtist: albumArtist.trim() || null,
      bpm: bpm ? parseInt(bpm, 10) : null,
      label: label.trim() || null,
      isrc: isrc.trim() || null,
      releaseDate: releaseDate || null,
      originalDate: originalDate || null,
      originalYear: originalYear ? parseInt(originalYear, 10) : null,
      totalTracks: totalTracks ? parseInt(totalTracks, 10) : null,
      totalDiscs: totalDiscs ? parseInt(totalDiscs, 10) : null,
      lyrics: lyrics.trim() || null,
    };

    onSave(changes);
  };

  const hasChanges =
    trackNumber !== (track.trackNumber?.toString() ?? "") ||
    albumArtist !== (track.albumArtist ?? "") ||
    bpm !== (track.bpm?.toString() ?? "") ||
    label !== (track.label ?? "") ||
    isrc !== (track.isrc ?? "") ||
    releaseDate !== savedReleaseDate ||
    originalDate !== savedOriginalDate ||
    originalYear !== (track.originalYear?.toString() ?? "") ||
    totalTracks !== (track.totalTracks?.toString() ?? "") ||
    totalDiscs !== (track.totalDiscs?.toString() ?? "") ||
    lyrics !== (track.lyrics ?? "");

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="trackNumber">Track Number</Label>
          <Input
            id="trackNumber"
            type="number"
            value={trackNumber}
            onChange={(e) => setTrackNumber(e.target.value)}
            placeholder="1"
            min="1"
            disabled={disabled}
          />
        </div>

        <div>
          <Label htmlFor="totalTracks">Total Tracks</Label>
          <Input
            id="totalTracks"
            type="number"
            value={totalTracks}
            onChange={(e) => setTotalTracks(e.target.value)}
            placeholder="12"
            min="1"
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="albumArtist">Album Artist</Label>
        <Input
          id="albumArtist"
          value={albumArtist}
          onChange={(e) => setAlbumArtist(e.target.value)}
          placeholder="Album artist name"
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="bpm">BPM</Label>
          <Input
            id="bpm"
            type="number"
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            placeholder="120"
            min="1"
            max="300"
            disabled={disabled}
          />
        </div>

        <div>
          <Label htmlFor="totalDiscs">Total Discs</Label>
          <Input
            id="totalDiscs"
            type="number"
            value={totalDiscs}
            onChange={(e) => setTotalDiscs(e.target.value)}
            placeholder="1"
            min="1"
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="label">Label</Label>
        <Input
          id="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Record label"
          disabled={disabled}
        />
      </div>

      <div>
        <Label htmlFor="isrc">ISRC</Label>
        <Input
          id="isrc"
          value={isrc}
          onChange={(e) => setIsrc(e.target.value)}
          placeholder="USRC17607839"
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="releaseDate">Release Date</Label>
          <Input
            id="releaseDate"
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <Label htmlFor="originalDate">Original Date</Label>
          <Input
            id="originalDate"
            type="date"
            value={originalDate}
            onChange={(e) => setOriginalDate(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="originalYear">Original Year</Label>
        <Input
          id="originalYear"
          type="number"
          value={originalYear}
          onChange={(e) => setOriginalYear(e.target.value)}
          placeholder="Original release year"
          min="1900"
          max={new Date().getFullYear() + 1}
          disabled={disabled}
        />
      </div>

      <div>
        <Label htmlFor="lyrics">Lyrics</Label>
        <Textarea
          id="lyrics"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Song lyrics..."
          rows={8}
          className="font-mono text-xs"
          disabled={disabled}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="submit" disabled={!hasChanges || disabled}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}

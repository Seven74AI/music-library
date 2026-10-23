import { HistoryList } from "#app/components/history/history-list.tsx";

interface HistoryTabProps {
  trackId: string;
  onRestore: (editId: string, comment: string | null) => void;
}

const TRACK_FIELD_NAMES: Record<string, string> = {
  title: "Title",
  artistId: "Artist",
  albumId: "Album",
  genre: "Genre",
  year: "Year",
  trackNumber: "Track Number",
  albumArtist: "Album Artist",
  bpm: "BPM",
  label: "Label",
  isrc: "ISRC",
  releaseDate: "Release Date",
  originalDate: "Original Date",
  originalYear: "Original Year",
  totalTracks: "Total Tracks",
  totalDiscs: "Total Discs",
  lyrics: "Lyrics",
};

export function HistoryTab({ trackId, onRestore }: HistoryTabProps) {
  return (
    <HistoryList
      entityType="tracks"
      entityId={trackId}
      fieldNames={TRACK_FIELD_NAMES}
      onRestore={onRestore}
    />
  );
}

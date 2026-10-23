import { HistoryList } from "#app/components/history/history-list.tsx";

interface ArtistHistoryTabProps {
  artistId: string;
  onRestore: (editId: string, comment: string | null) => void;
}

const ARTIST_FIELD_NAMES: Record<string, string> = {
  name: "Name",
  bio: "Biography",
  genre: "Genre",
  country: "Country",
  imageUrl: "Image URL",
  website: "Website",
};

export function ArtistHistoryTab({ artistId, onRestore }: ArtistHistoryTabProps) {
  return (
    <HistoryList
      entityType="artists"
      entityId={artistId}
      fieldNames={ARTIST_FIELD_NAMES}
      onRestore={onRestore}
    />
  );
}

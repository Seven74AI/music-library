import { HistoryList } from "#app/components/history/history-list.tsx";

interface AlbumHistoryTabProps {
  albumId: string;
  onRestore: (editId: string, comment: string | null) => void;
}

const ALBUM_FIELD_NAMES: Record<string, string> = {
  name: "Name",
  artistId: "Artist",
  year: "Year",
  coverImageId: "Cover Image",
};

export function AlbumHistoryTab({ albumId, onRestore }: AlbumHistoryTabProps) {
  return (
    <HistoryList
      entityType="albums"
      entityId={albumId}
      fieldNames={ALBUM_FIELD_NAMES}
      onRestore={onRestore}
    />
  );
}

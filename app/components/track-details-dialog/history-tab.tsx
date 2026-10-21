import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { displayedChange, type HistoryLabel } from "#app/utils/history-display.ts";
import { CommentDialog } from "./comment-dialog";

interface HistoryEntry {
  id: string;
  editedAt: string;
  editedBy: {
    id: string;
    username: string;
    name: string | null;
  };
  comment: string | null;
  changes: Record<
    string,
    {
      from: string | number | null;
      to: string | number | null;
    }
  >;
  labels?: Record<string, HistoryLabel>;
}

interface HistoryTabProps {
  trackId: string;
  onRestore: (editId: string, comment: string | null) => void;
}

export function HistoryTab({ trackId, onRestore }: HistoryTabProps) {
  const fetcher = useFetcher<{ history: HistoryEntry[] }>();
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [seenTrackId, setSeenTrackId] = useState(trackId);
  const requestedTrackId = useRef<string | null>(null);
  const loadedTrackId = useRef<string | null>(null);
  const seenData = useRef<unknown>(undefined);

  if (seenTrackId !== trackId) {
    setSeenTrackId(trackId);
    setShowRestoreDialog(false);
    setSelectedEditId(null);
  }

  if (fetcher.data !== seenData.current) {
    seenData.current = fetcher.data;
    if (fetcher.data && requestedTrackId.current) {
      loadedTrackId.current = requestedTrackId.current;
    }
  }

  const matchesTrack = loadedTrackId.current === trackId && fetcher.data != null;
  const history = matchesTrack ? (fetcher.data?.history ?? []) : [];
  const isLoading = !matchesTrack;

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (loadedTrackId.current === trackId && fetcher.data) {
      requestedTrackId.current = null;
      return;
    }
    // A failed load leaves the previous payload in place. Don't retry it forever.
    if (requestedTrackId.current === trackId) return;
    requestedTrackId.current = trackId;
    fetcher.load(`/api/metadata/tracks/${encodeURIComponent(trackId)}/history`);
  }, [fetcher, trackId]);

  const handleRestoreClick = (editId: string) => {
    setSelectedEditId(editId);
    setShowRestoreDialog(true);
  };

  const handleRestoreConfirm = (comment: string | null) => {
    if (selectedEditId && comment) {
      onRestore(selectedEditId, comment);
      setShowRestoreDialog(false);
      setSelectedEditId(null);
    }
  };

  const formatFieldName = (field: string): string => {
    const fieldNames: Record<string, string> = {
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
    return fieldNames[field] || field;
  };

  const formatValue = (value: string | number | null): string => {
    if (value === null || value === undefined) return "(empty)";
    if (typeof value === "string" && value.includes("T")) {
      // Likely a date
      return new Date(value).toLocaleDateString();
    }
    return String(value);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">No edit history yet</div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {history.map((entry, index) => (
          <div
            key={entry.id}
            className="rounded-lg border p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {entry.editedBy.name || entry.editedBy.username}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.editedAt).toLocaleString()}
                  </span>
                </div>
                {entry.comment && (
                  <div className="text-sm text-muted-foreground italic">
                    &quot;{entry.comment}&quot;
                  </div>
                )}
              </div>
              {index > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestoreClick(entry.id)}
                >
                  <Icon name="reset" className="mr-2 h-4 w-4" />
                  Restore
                </Button>
              )}
            </div>

            <div className="mt-3 space-y-1">
              {Object.entries(entry.changes).map(([field, change]) => {
                const shown = displayedChange(change, entry.labels?.[field], formatValue);
                return (
                  <div key={field} className="text-xs">
                    <span className="font-medium">{formatFieldName(field)}:</span>
                    <span className="text-muted-foreground ml-2">
                      {shown.from} → {shown.to}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showRestoreDialog && (
        <CommentDialog
          open={showRestoreDialog}
          onOpenChange={setShowRestoreDialog}
          onSubmit={handleRestoreConfirm}
          title="Restore Version"
          description="Please explain why you're restoring this version. This comment is required."
          required={true}
        />
      )}
    </>
  );
}

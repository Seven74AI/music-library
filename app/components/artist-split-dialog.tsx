/**
 * Artist Split Dialog Component
 * Allows curators to split an artist by moving selected tracks to a new artist
 */

import { useFetcher } from "react-router";
import { useState } from "react";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import { Label } from "#app/components/ui/label";
import { Input } from "#app/components/ui/input";
import { Textarea } from "#app/components/ui/textarea";
import { Icon } from "#app/components/ui/icon";
import { Checkbox } from "#app/components/ui/checkbox";

export interface TrackOption {
  id: string;
  title: string;
  album?: string;
}

interface ArtistSplitDialogProps {
  artistId: string;
  artistName: string;
  tracks: TrackOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplit?: () => void;
}

export function ArtistSplitDialog({
  artistId,
  artistName,
  tracks,
  open,
  onOpenChange,
  onSplit,
}: ArtistSplitDialogProps) {
  const splitFetcher = useFetcher();
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [newArtistName, setNewArtistName] = useState("");
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [appliedArtistId, setAppliedArtistId] = useState(artistId);
  // The artist page keeps this dialog mounted across /artists/:artistId navigations.
  if (appliedArtistId !== artistId) {
    setAppliedArtistId(artistId);
    setSelectedTrackIds(new Set());
    setNewArtistName("");
    setComment("");
    setConfirmed(false);
  }

  const isSubmitting = splitFetcher.state !== "idle";
  const canSubmit =
    selectedTrackIds.size > 0 &&
    selectedTrackIds.size < tracks.length &&
    newArtistName.trim() &&
    comment.trim() &&
    confirmed;

  const handleToggleTrack = (trackId: string) => {
    const newSelection = new Set(selectedTrackIds);
    if (newSelection.has(trackId)) {
      newSelection.delete(trackId);
    } else {
      newSelection.add(trackId);
    }
    setSelectedTrackIds(newSelection);
  };

  const handleToggleAll = () => {
    if (selectedTrackIds.size === tracks.length) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(tracks.map((t) => t.id)));
    }
  };

  const handleSplit = () => {
    if (!canSubmit) return;

    splitFetcher.submit(
      {
        trackIds: Array.from(selectedTrackIds),
        newArtistName,
        comment,
      },
      {
        method: "POST",
        action: `/api/metadata/artists/${artistId}/split`,
        encType: "application/json",
      },
    );
  };

  // Close dialog and notify parent on successful split
  if (splitFetcher.state === "idle" && splitFetcher.data && open) {
    setTimeout(() => {
      onOpenChange(false);
      onSplit?.();
      setSelectedTrackIds(new Set());
      setNewArtistName("");
      setComment("");
      setConfirmed(false);
    }, 0);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Split Artist</DialogTitle>
          <DialogDescription>
            Move selected tracks from "{artistName}" to a new artist. This is useful for separating
            incorrectly merged artists or featuring artists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="new-artist-name">
              New Artist Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-artist-name"
              value={newArtistName}
              onChange={(e) => setNewArtistName(e.target.value)}
              placeholder="Enter the name for the new artist"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Select Tracks to Move ({selectedTrackIds.size} of {tracks.length} selected)
                <span className="text-destructive">*</span>
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={handleToggleAll}>
                {selectedTrackIds.size === tracks.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              <div className="space-y-1 p-2">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                    onClick={() => handleToggleTrack(track.id)}
                  >
                    <Checkbox
                      checked={selectedTrackIds.has(track.id)}
                      onCheckedChange={() => handleToggleTrack(track.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{track.title}</div>
                      {track.album && (
                        <div className="text-sm text-muted-foreground truncate">{track.album}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {selectedTrackIds.size === tracks.length && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                You cannot move all tracks. At least one track must remain with the original artist.
              </p>
            )}
          </div>

          {selectedTrackIds.size > 0 && selectedTrackIds.size < tracks.length && (
            <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950/20">
              <div className="flex items-start gap-3">
                <Icon
                  name="question-mark-circled"
                  className="h-5 w-5 text-blue-600 dark:text-blue-500 mt-0.5"
                />
                <div className="flex-1 space-y-2">
                  <div className="font-medium text-blue-900 dark:text-blue-100">This will:</div>
                  <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <li>• Create a new artist: "{newArtistName || "(enter name above)"}"</li>
                    <li>
                      • Move {selectedTrackIds.size} track
                      {selectedTrackIds.size === 1 ? "" : "s"} to the new artist
                    </li>
                    <li>
                      • Keep {tracks.length - selectedTrackIds.size} track
                      {tracks.length - selectedTrackIds.size === 1 ? "" : "s"} with "{artistName}"
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="split-comment">
              Split Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="split-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Explain why you're splitting this artist (e.g., 'Separating featuring artist from main artist')"
              rows={3}
              required
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="confirm-split"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
            />
            <Label htmlFor="confirm-split" className="cursor-pointer text-sm">
              I understand this will create a new artist and move {selectedTrackIds.size} track
              {selectedTrackIds.size === 1 ? "" : "s"}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSplit} disabled={!canSubmit || isSubmitting} variant="default">
            {isSubmitting && <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />}
            Split Artist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

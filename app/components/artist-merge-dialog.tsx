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
import { Textarea } from "#app/components/ui/textarea";
import { Icon } from "#app/components/ui/icon";

export interface ArtistOption {
  id: string;
  name: string;
  trackCount: number;
  albumCount: number;
}

interface ArtistMergeDialogProps {
  sourceArtist?: ArtistOption;
  targetArtist?: ArtistOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

export function ArtistMergeDialog({
  sourceArtist: initialSource,
  targetArtist: initialTarget,
  open,
  onOpenChange,
  onMerged,
}: ArtistMergeDialogProps) {
  const mergeFetcher = useFetcher();
  const [sourceArtist, setSourceArtist] = useState(initialSource);
  const [targetArtist, setTargetArtist] = useState(initialTarget);
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [appliedPair, setAppliedPair] = useState(
    `${initialSource?.id ?? ""}:${initialTarget?.id ?? ""}`,
  );
  const nextPair = `${initialSource?.id ?? ""}:${initialTarget?.id ?? ""}`;
  // The dialog stays mounted while the parent picks a pair, so the first
  // state snapshot is empty. Apply the latest pair before paint.
  if (appliedPair !== nextPair) {
    setAppliedPair(nextPair);
    setSourceArtist(initialSource);
    setTargetArtist(initialTarget);
    setComment("");
    setConfirmed(false);
  }

  const isSubmitting = mergeFetcher.state !== "idle";
  const canSubmit = sourceArtist && targetArtist && comment.trim() && confirmed;

  const handleSwap = () => {
    const temp = sourceArtist;
    setSourceArtist(targetArtist);
    setTargetArtist(temp);
  };

  const handleMerge = () => {
    if (!canSubmit) return;

    mergeFetcher.submit(
      {
        sourceId: sourceArtist!.id,
        targetId: targetArtist!.id,
        comment,
      },
      {
        method: "POST",
        action: "/api/metadata/artists/merge",
        encType: "application/json",
      },
    );
  };

  // Close dialog and notify parent on successful merge
  if (mergeFetcher.state === "idle" && mergeFetcher.data && open) {
    setTimeout(() => {
      mergeFetcher.reset();
      onOpenChange(false);
      onMerged?.();
      setConfirmed(false);
      setComment("");
    }, 0);
  }

  const totalTracks = (sourceArtist?.trackCount || 0) + (targetArtist?.trackCount || 0);
  const totalAlbums = (sourceArtist?.albumCount || 0) + (targetArtist?.albumCount || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge Artists</DialogTitle>
          <DialogDescription>
            Combine two duplicate artists into one. All tracks and albums will be moved to the
            target artist.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label>Source Artist (will be merged)</Label>
              <div className="mt-2 rounded-lg border p-4 bg-muted/50">
                {sourceArtist ? (
                  <>
                    <div className="font-medium">{sourceArtist.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {sourceArtist.trackCount} tracks, {sourceArtist.albumCount} albums
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No artist selected</div>
                )}
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSwap}
                disabled={!sourceArtist || !targetArtist}
              >
                <Icon name="arrows-up-down" className="h-4 w-4" />
                <span className="sr-only">Swap source and target</span>
              </Button>
            </div>

            <div>
              <Label>Target Artist (will receive all content)</Label>
              <div className="mt-2 rounded-lg border p-4 bg-muted/50">
                {targetArtist ? (
                  <>
                    <div className="font-medium">{targetArtist.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {targetArtist.trackCount} tracks, {targetArtist.albumCount} albums
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No artist selected</div>
                )}
              </div>
            </div>
          </div>

          {sourceArtist && targetArtist && (
            <div className="rounded-lg border p-4 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <Icon
                  name="question-mark-circled"
                  className="h-5 w-5 text-amber-600 dark:text-amber-500 mt-0.5"
                />
                <div className="flex-1 space-y-2">
                  <div className="font-medium text-amber-900 dark:text-amber-100">This will:</div>
                  <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                    <li>
                      • Move {sourceArtist.trackCount} tracks from "{sourceArtist.name}" to "
                      {targetArtist.name}"
                    </li>
                    <li>
                      • Move {sourceArtist.albumCount} albums from "{sourceArtist.name}" to "
                      {targetArtist.name}"
                    </li>
                    <li>• Mark "{sourceArtist.name}" as merged</li>
                    <li>
                      • Result: "{targetArtist.name}" will have {totalTracks} tracks and{" "}
                      {totalAlbums} albums
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="merge-comment">
              Merge Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="merge-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Explain why these artists are duplicates (e.g., 'Same artist, different spelling')"
              rows={3}
              required
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="confirm-merge"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="confirm-merge" className="cursor-pointer text-sm">
              I understand this action will merge {sourceArtist?.trackCount || 0} tracks and{" "}
              {sourceArtist?.albumCount || 0} albums
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
          <Button onClick={handleMerge} disabled={!canSubmit || isSubmitting} variant="default">
            {isSubmitting && <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

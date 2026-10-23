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

export interface AlbumOption {
  id: string;
  name: string;
  trackCount: number;
  year: number | null;
}

interface AlbumMergeDialogProps {
  sourceAlbum?: AlbumOption;
  targetAlbum?: AlbumOption;
  artistName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

export function AlbumMergeDialog({
  sourceAlbum: initialSource,
  targetAlbum: initialTarget,
  artistName = "Unknown Artist",
  open,
  onOpenChange,
  onMerged,
}: AlbumMergeDialogProps) {
  const mergeFetcher = useFetcher();
  const [sourceAlbum, setSourceAlbum] = useState(initialSource);
  const [targetAlbum, setTargetAlbum] = useState(initialTarget);
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [appliedPair, setAppliedPair] = useState(
    `${initialSource?.id ?? ""}:${initialTarget?.id ?? ""}`,
  );
  const nextPair = `${initialSource?.id ?? ""}:${initialTarget?.id ?? ""}`;
  // The dialog stays mounted across groups. Apply the latest pair before paint.
  if (appliedPair !== nextPair) {
    setAppliedPair(nextPair);
    setSourceAlbum(initialSource);
    setTargetAlbum(initialTarget);
    setComment("");
    setConfirmed(false);
  }

  const isSubmitting = mergeFetcher.state !== "idle";
  const canSubmit = sourceAlbum && targetAlbum && comment.trim() && confirmed;

  const handleSwap = () => {
    const temp = sourceAlbum;
    setSourceAlbum(targetAlbum);
    setTargetAlbum(temp);
  };

  const handleMerge = () => {
    if (!canSubmit) return;

    mergeFetcher.submit(
      {
        sourceId: sourceAlbum!.id,
        targetId: targetAlbum!.id,
        comment,
      },
      {
        method: "POST",
        action: "/api/metadata/albums/merge",
        encType: "application/json",
      },
    );
  };

  if (mergeFetcher.state === "idle" && mergeFetcher.data && open) {
    setTimeout(() => {
      mergeFetcher.reset();
      onOpenChange(false);
      onMerged?.();
      setConfirmed(false);
      setComment("");
    }, 0);
  }

  const totalTracks = (sourceAlbum?.trackCount || 0) + (targetAlbum?.trackCount || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge Albums</DialogTitle>
          <DialogDescription>
            Combine two duplicate albums into one. All tracks will be moved to the target album.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="text-sm text-muted-foreground">
            Artist: <span className="font-medium text-foreground">{artistName}</span>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Source Album (will be merged)</Label>
              <div className="mt-2 rounded-lg border p-4 bg-muted/50">
                {sourceAlbum ? (
                  <>
                    <div className="font-medium">{sourceAlbum.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {sourceAlbum.year && `${sourceAlbum.year} • `}
                      {sourceAlbum.trackCount} tracks
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No album selected</div>
                )}
              </div>
            </div>

            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSwap}
                disabled={!sourceAlbum || !targetAlbum}
              >
                <Icon name="arrows-up-down" className="h-4 w-4" />
                <span className="sr-only">Swap source and target</span>
              </Button>
            </div>

            <div>
              <Label>Target Album (will receive all content)</Label>
              <div className="mt-2 rounded-lg border p-4 bg-muted/50">
                {targetAlbum ? (
                  <>
                    <div className="font-medium">{targetAlbum.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {targetAlbum.year && `${targetAlbum.year} • `}
                      {targetAlbum.trackCount} tracks
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No album selected</div>
                )}
              </div>
            </div>
          </div>

          {sourceAlbum && targetAlbum && (
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
                      • Move {sourceAlbum.trackCount} tracks from "{sourceAlbum.name}" to "
                      {targetAlbum.name}"
                    </li>
                    <li>• Mark "{sourceAlbum.name}" as merged</li>
                    <li>
                      • Result: "{targetAlbum.name}" will have {totalTracks} tracks
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
              placeholder="Explain why these albums are duplicates..."
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
              I understand this action will merge {sourceAlbum?.trackCount || 0} tracks
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

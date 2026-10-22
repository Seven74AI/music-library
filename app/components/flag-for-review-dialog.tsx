import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select";
import { Label } from "#app/components/ui/label";
import { Textarea } from "#app/components/ui/textarea";
import { Icon } from "#app/components/ui/icon";
import { toast } from "#app/components/ui/use-toast.ts";
import { filedReportMessage, queueMatter } from "#app/features/curator/review-queue.ts";

interface FlagForReviewDialogProps {
  entityType: "track" | "artist" | "album";
  entityId: string;
  entityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FLAG_TYPES = [
  { value: "wrong_metadata", label: "Wrong metadata" },
  { value: "missing_info", label: "Missing info" },
  { value: "low_quality", label: "Low quality" },
  { value: "duplicate", label: "Potential duplicate" },
  { value: "other", label: "Other issue" },
] as const;

export function FlagForReviewDialog({
  entityType,
  entityId,
  entityName,
  open,
  onOpenChange,
}: FlagForReviewDialogProps) {
  const fetcher = useFetcher();
  const [flagType, setFlagType] = useState<string>("");
  const [comment, setComment] = useState("");
  const identity = `${entityType}:${entityId}`;
  // Album, artist, and track pages keep one dialog mounted and change the entity.
  const [draftIdentity, setDraftIdentity] = useState(identity);
  const submittedIdentity = useRef<string | null>(null);
  if (draftIdentity !== identity) {
    setDraftIdentity(identity);
    setFlagType("");
    setComment("");
  }

  const isSubmitting = fetcher.state !== "idle";
  const isValid = flagType !== "";
  const seenResult = useRef<unknown>(null);
  const showError =
    submittedIdentity.current === identity && fetcher.state === "idle" && fetcher.data?.error;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.success) return;
    if (seenResult.current === fetcher.data) return;
    if (submittedIdentity.current !== identity) return;
    seenResult.current = fetcher.data;
    toast({
      title: "Flag filed",
      description: filedReportMessage(
        entityName,
        queueMatter({ issueType: flagType, description: comment }),
      ),
    });
    setFlagType("");
    setComment("");
    onOpenChange(false);
  }, [
    comment,
    entityId,
    entityName,
    entityType,
    fetcher.data,
    fetcher.state,
    flagType,
    identity,
    onOpenChange,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    submittedIdentity.current = identity;
    const formData = new FormData();
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    formData.append("issueType", flagType);
    if (comment.trim()) {
      formData.append("comment", comment);
    }

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/curator/queue/flag",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Flag for Review</DialogTitle>
          <DialogDescription>Flag "{entityName}" for review by other curators.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="flag-type">Issue Type *</Label>
              <Select value={flagType} onValueChange={setFlagType}>
                <SelectTrigger id="flag-type">
                  <SelectValue placeholder="Select an issue type" />
                </SelectTrigger>
                {/* DialogContent is z-53. The shared select menu is z-50 and renders under it. */}
                <SelectContent className="z-[70]">
                  {FLAG_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comment">Comment (optional)</Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add any additional context or notes..."
                rows={4}
                maxLength={500}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{comment.length}/500 characters</p>
            </div>

            {showError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <Icon name="question-mark-circled" />
                <span>{fetcher.data.error}</span>
              </div>
            )}
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
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting && <Icon name="update" className="mr-2 animate-spin" />}
              Flag for Review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

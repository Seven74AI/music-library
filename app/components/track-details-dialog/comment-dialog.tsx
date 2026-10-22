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
import { Textarea } from "#app/components/ui/textarea";
import { Label } from "#app/components/ui/label";

interface CommentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (comment: string | null) => void;
  title: string;
  description: string;
  required: boolean;
}

export function CommentDialog({
  open,
  onOpenChange,
  onSubmit,
  title,
  description,
  required,
}: CommentDialogProps) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (required && !comment.trim()) {
      setError("Comment is required");
      return;
    }

    onSubmit(comment.trim() || null);
    setComment("");
    setError("");
  };

  const handleCancel = () => {
    setComment("");
    setError("");
    onOpenChange(false);
  };

  const characterCount = comment.length;
  const maxCharacters = 500;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="comment">
            Comment
            {required && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Textarea
            id="comment"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (error) setError("");
            }}
            placeholder={required ? "Explain your changes..." : "Optional comment..."}
            rows={4}
            maxLength={maxCharacters}
            aria-invalid={error ? true : undefined}
            className={error ? "border-input-invalid" : ""}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            {error && <span className="text-destructive">{error}</span>}
            <span className={error ? "ml-auto" : ""}>
              {characterCount}/{maxCharacters}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {required ? "Submit" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

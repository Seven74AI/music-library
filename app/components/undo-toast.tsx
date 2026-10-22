import { useEffect, useState } from "react";
import { useSubmit } from "react-router";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import { toast } from "#app/components/ui/use-toast";
import { Icon } from "#app/components/ui/icon";

interface UndoToastProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  onUndo?: () => void;
}

const UNDO_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function UndoToast({ open, onOpenChange, trackId, onUndo }: UndoToastProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [currentToast, setCurrentToast] = useState<{
    id: string;
    dismiss: () => void;
    update: (props: any) => void;
  } | null>(null);
  const submit = useSubmit();

  useEffect(() => {
    if (!open) return;

    const startTime = Date.now();
    let toastRef: ReturnType<typeof toast> | null = null;

    // Update function that will be called periodically
    const updateToast = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, UNDO_TIMEOUT_MS - elapsed);
      const minutesRemaining = Math.floor(remaining / 1000 / 60);
      const secondsRemaining = Math.floor((remaining / 1000) % 60);

      if (remaining === 0) {
        if (toastRef) {
          toastRef.dismiss();
        }
        onOpenChange(false);
        return;
      }

      const timeString =
        minutesRemaining > 0
          ? `${minutesRemaining}:${secondsRemaining.toString().padStart(2, "0")}`
          : `${secondsRemaining}s`;

      if (toastRef) {
        toastRef.update({
          id: toastRef.id,
          title: "Changes saved successfully",
          description: (
            <div className="flex items-center justify-between gap-4">
              <span>You have {timeString} to undo</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmDialog(true)}
                className="shrink-0"
              >
                <Icon name="reset" className="mr-2 h-4 w-4" />
                Undo
              </Button>
            </div>
          ),
          variant: "success",
        });
      }
    };

    // Show initial toast
    toastRef = toast({
      title: "Changes saved successfully",
      description: (
        <div className="flex items-center justify-between gap-4">
          <span>You have 5:00 to undo</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfirmDialog(true)}
            className="shrink-0"
          >
            <Icon name="reset" className="mr-2 h-4 w-4" />
            Undo
          </Button>
        </div>
      ),
      duration: UNDO_TIMEOUT_MS,
      variant: "success",
    });

    setCurrentToast(toastRef);

    // Update timer every second
    const interval = setInterval(updateToast, 1000);

    return () => {
      clearInterval(interval);
      if (toastRef) {
        toastRef.dismiss();
      }
    };
  }, [open, onOpenChange]);

  const handleUndo = async () => {
    // Get the most recent edit ID
    try {
      const response = await fetch(`/api/metadata/tracks/${trackId}/history`);
      const data = (await response.json()) as { history: Array<{ id: string }> };

      if (data.history.length > 0 && data.history[0]) {
        const mostRecentEditId = data.history[0].id;

        // Call restore endpoint with automatic comment
        submit(
          { comment: "Quick undo within 5 minutes of edit" },
          {
            method: "POST",
            action: `/api/metadata/tracks/${trackId}/restore/${mostRecentEditId}`,
            encType: "application/json",
            navigate: false,
          },
        );

        // Dismiss the current toast and show success message
        if (currentToast) {
          currentToast.dismiss();
        } else {
          // Fallback in case toast ref isn't available
          console.warn("Toast reference not available");
        }

        toast({
          title: "Changes undone",
          description: "The track has been restored to its previous state",
          variant: "default",
          duration: 3000,
        });

        onOpenChange(false);
        if (onUndo) onUndo();
      }
    } catch (error) {
      console.error("Failed to undo changes:", error);
      toast({
        title: "Failed to undo",
        description: "An error occurred while undoing the changes",
        variant: "destructive",
      });
    }

    setShowConfirmDialog(false);
  };

  return (
    <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Undo Changes?</DialogTitle>
          <DialogDescription>
            This will revert the track to its previous state before your last edit. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setShowConfirmDialog(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleUndo}>
            <Icon name="reset" className="mr-2 h-4 w-4" />
            Undo Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

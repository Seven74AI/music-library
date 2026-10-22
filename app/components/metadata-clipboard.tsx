import { useCallback, useRef, useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Checkbox } from "#app/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  CLIPBOARD_FIELDS,
  CLIPBOARD_FIELD_LABELS,
  clipboardFromTrackDetails,
  copyMetadata,
  fetchTrackForClipboard,
  formatClipboardField,
  pasteSelectedMetadata,
  peekMetadataClipboard,
  type ClipboardField,
  type MetadataClipboard,
} from "#app/features/curator/metadata-clipboard.ts";

export function PasteMetadataDialog({
  open,
  onOpenChange,
  trackId,
  clipboard,
  onApply,
  applying = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  clipboard: MetadataClipboard | null;
  onApply: (fields: ClipboardField[]) => void;
  applying?: boolean;
}) {
  const [selected, setSelected] = useState<ClipboardField[]>([...CLIPBOARD_FIELDS]);
  const returnFocus = useRef<HTMLElement | null>(null);

  const toggle = (field: ClipboardField, checked: boolean) => {
    setSelected((current) => {
      if (checked) return current.includes(field) ? current : [...current, field];
      return current.filter((item) => item !== field);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setSelected([...CLIPBOARD_FIELDS]);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto"
        aria-describedby="paste-metadata-description"
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Paste metadata</DialogTitle>
          <DialogDescription id="paste-metadata-description">
            {clipboard
              ? "Choose which copied fields to apply to this track."
              : "Copy metadata from a track first."}
          </DialogDescription>
        </DialogHeader>
        {clipboard ? (
          <fieldset className="space-y-1">
            <legend className="sr-only">Fields to paste onto track {trackId}</legend>
            {CLIPBOARD_FIELDS.map((field) => (
              <div key={field} className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id={`paste-${trackId}-${field}`}
                  checked={selected.includes(field)}
                  onCheckedChange={(checked) => toggle(field, checked === true)}
                />
                <Label htmlFor={`paste-${trackId}-${field}`} className="flex-1 cursor-pointer">
                  <span>{CLIPBOARD_FIELD_LABELS[field]}</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {formatClipboardField(clipboard, field)}
                  </span>
                </Label>
              </div>
            ))}
          </fieldset>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!clipboard || selected.length === 0 || applying}
            onClick={() => onApply(selected)}
          >
            {applying ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useMetadataClipboard(trackId: string) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [clipboard, setClipboard] = useState<MetadataClipboard | null>(null);

  const copy = useCallback(async () => {
    try {
      const track = await fetchTrackForClipboard(trackId);
      const next = clipboardFromTrackDetails(track);
      copyMetadata(next);
      setClipboard(next);
      toast({ title: "Metadata copied" });
    } catch (error) {
      console.error("Failed to copy metadata:", error);
      toast({
        title: "Could not copy metadata",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }, [trackId]);

  const openPaste = useCallback((delayMs = 0) => {
    window.setTimeout(() => {
      setClipboard(peekMetadataClipboard());
      setPasteOpen(true);
    }, delayMs);
  }, []);

  const apply = useCallback(
    async (fields: ClipboardField[]) => {
      setApplying(true);
      try {
        await pasteSelectedMetadata(trackId, fields);
        toast({ title: "Metadata pasted" });
        setPasteOpen(false);
      } catch (error) {
        console.error("Failed to paste metadata:", error);
        toast({
          title: "Could not paste metadata",
          description: "The track was not changed. Try again.",
          variant: "destructive",
        });
      } finally {
        setApplying(false);
      }
    },
    [trackId],
  );

  const dialog = (
    <PasteMetadataDialog
      open={pasteOpen}
      onOpenChange={setPasteOpen}
      trackId={trackId}
      clipboard={clipboard}
      onApply={(fields) => void apply(fields)}
      applying={applying}
    />
  );

  return { copy, openPaste, dialog };
}

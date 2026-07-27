import { useEffect, useState } from "react";
import { useAutoplayGuide } from "#app/hooks/use-autoplay-guide.ts";
import { Button } from "#app/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog.tsx";
import { Icon } from "#app/components/ui/icon.tsx";

type BrowserName = "firefox" | "other";

function detectBrowser(): BrowserName {
  if (typeof navigator === "undefined") return "other";
  if (navigator.userAgent.includes("Firefox")) return "firefox";
  return "other";
}

export function AutoplayGuideDialog() {
  const { showGuide, dismissGuide } = useAutoplayGuide();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (showGuide) setOpen(true);
  }, [showGuide]);

  const isFirefox = detectBrowser() === "firefox";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="speaker-wave" className="h-5 w-5" />
            Autoplay was blocked
          </DialogTitle>
          <DialogDescription asChild>
            <div>
              <p className="mb-3">
                Your browser blocked automatic playback. Browsers require you to interact with a
                site before they allow audio to play on its own.
              </p>
              <p className="mb-3">
                <strong>Tap Play</strong> when you want to listen &mdash; after a few manual plays
                your browser will learn to trust this site and autoplay will work automatically.
              </p>
              {isFirefox && (
                <p className="mb-3 text-sm text-muted-foreground">
                  Firefox users: you can also allow it now via{" "}
                  <strong>Settings &rarr; Site Permissions &rarr; Autoplay</strong>.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={dismissGuide}>
            Don&rsquo;t show again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

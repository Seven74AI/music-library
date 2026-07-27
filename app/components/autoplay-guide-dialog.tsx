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

type BrowserName = "chrome" | "safari" | "firefox" | "other";

function detectBrowser(): BrowserName {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "firefox";
  if (ua.includes("Edg")) return "chrome"; // Edge uses Chrome instructions
  if (ua.includes("Chrome")) return "chrome";
  if (ua.includes("Safari")) return "safari";
  return "other";
}

const browserInstructions: Record<BrowserName, { title: string; steps: string[] }> = {
  chrome: {
    title: "Allow autoplay in Chrome",
    steps: [
      "Tap the lock/tune icon in the address bar",
      "Tap **Site settings**",
      "Under **Sound**, select **Allow**",
      "Reload the page and try again",
    ],
  },
  safari: {
    title: "Allow autoplay in Safari",
    steps: [
      "Tap the **aA** icon in the address bar",
      "Tap **Settings for This Website**",
      "Set **Auto-Play** to **Allow All Auto-Play**",
      "Reload the page and try again",
    ],
  },
  firefox: {
    title: "Allow autoplay in Firefox",
    steps: [
      "Tap the autoplay icon in the address bar",
      "Select **Allow Audio and Video**",
      "Reload the page and try again",
    ],
  },
  other: {
    title: "Allow autoplay in your browser",
    steps: [
      "Look for a site settings or permissions option in the address bar",
      "Grant permission for audio/sound playback",
      "Reload the page and try again",
    ],
  },
};

export function AutoplayGuideDialog() {
  const { showGuide, dismissGuide } = useAutoplayGuide();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (showGuide) setOpen(true);
  }, [showGuide]);

  const browser = detectBrowser();
  const instructions = browserInstructions[browser];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="speaker-wave" className="h-5 w-5" />
            {instructions.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div>
              <p className="mb-3">
                Your browser is blocking automatic music playback. Follow these steps to allow it
                once, and it&rsquo;ll work from then on:
              </p>
              <ol className="flex list-inside list-decimal flex-col gap-2 mb-4">
                {instructions.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
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

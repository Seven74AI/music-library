import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { QueueSheet } from "./player-queue-sheet";

/**
 * Minimal player chrome when the queue has items but nothing is playing yet (cold queue actions).
 */
export function QueueOnlyPlayerBar({
  chromeRef,
  onClose,
  onStartPlayback,
  hasQueuedPlayback,
}: {
  chromeRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onStartPlayback?: () => void;
  hasQueuedPlayback: boolean;
}) {
  return (
    <div
      ref={chromeRef}
      className="fixed bottom-16 left-0 right-0 z-50 border-t border-border bg-background/95 shadow-lg backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:bottom-0"
      data-testid="player-queue-only-bar"
    >
      <div className="md:hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Queue ready</p>
            <p className="truncate text-xs text-muted-foreground">Press play to start listening</p>
          </div>
          <Button
            variant="default"
            size="lg"
            onClick={onStartPlayback}
            disabled={!hasQueuedPlayback}
            aria-label="Play"
            className="h-11 w-11 shrink-0 rounded-full p-0"
          >
            <Icon name="play" className="ml-0.5 h-5 w-5" />
          </Button>
          <QueueSheet triggerClassName="h-11 w-11 shrink-0 p-0" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close player"
            className="h-11 w-11 shrink-0 p-0"
          >
            <Icon name="x-mark" className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="container mx-auto hidden items-center justify-between gap-4 px-4 py-3 md:flex">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Queue ready</p>
          <p className="truncate text-xs text-muted-foreground">Press play to start listening</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="lg"
            onClick={onStartPlayback}
            disabled={!hasQueuedPlayback}
            aria-label="Play"
            className="h-10 w-10 rounded-full p-0"
          >
            <Icon name="play" className="ml-0.5 h-5 w-5" />
          </Button>
          <QueueSheet />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close player"
            className="h-8 w-8 p-0"
          >
            <Icon name="x-mark" className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

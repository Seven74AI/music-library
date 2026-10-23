import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { cn } from "#app/utils/misc";
import {
  formatPlayerTime,
  getPlaybackProgressPercent,
  isDurationKnown,
} from "./audio-player-format";

// `<input type="range">` rejects a non-finite `max` (Infinity renders an
// invalid/inert control and confuses assistive tech). When the duration is
// unknown the seek bar still needs a valid ceiling, so use a large finite
// sentinel instead.
const UNKNOWN_DURATION_MAX = 1e6; // seconds (~11.5 days), far past any real track

interface PlayerSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  className?: string;
}

function PlayerSeekBar({
  currentTime,
  duration,
  onSeek,
  onSeekStart,
  onSeekEnd,
  className,
}: PlayerSeekBarProps) {
  return (
    <div className={cn("flex items-center gap-2 w-full", className)}>
      <span className="text-xs text-muted-foreground tabular-nums min-w-[3rem] text-right">
        {formatPlayerTime(currentTime)}
      </span>
      <input
        type="range"
        min="0"
        max={isDurationKnown(duration) ? duration : UNKNOWN_DURATION_MAX}
        step="0.1"
        value={isNaN(currentTime) ? 0 : currentTime}
        onChange={onSeek}
        onMouseDown={onSeekStart}
        onMouseUp={onSeekEnd}
        onTouchStart={onSeekStart}
        onTouchEnd={onSeekEnd}
        className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        style={{
          background: isDurationKnown(duration)
            ? `linear-gradient(to right, var(--primary) 0%, var(--primary) ${getPlaybackProgressPercent(currentTime, duration)}%, var(--muted) ${getPlaybackProgressPercent(currentTime, duration)}%, var(--muted) 100%)`
            : undefined,
        }}
        aria-label="Seek"
      />
      <span className="text-xs text-muted-foreground tabular-nums min-w-[3rem]">
        {isDurationKnown(duration) ? formatPlayerTime(duration) : "--:--"}
      </span>
    </div>
  );
}

interface PlayerTransportControlsProps {
  isPlaying: boolean;
  isAudioLoading: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayPause: () => void;
  size?: "default" | "large";
}

function PlayerTransportControls({
  isPlaying,
  isAudioLoading,
  hasNext,
  hasPrevious,
  onPrevious,
  onNext,
  onTogglePlayPause,
  size = "default",
}: PlayerTransportControlsProps) {
  const playButtonClass =
    size === "large" ? "h-14 w-14 rounded-full p-0" : "h-10 w-10 rounded-full p-0";
  const playIconClass = size === "large" ? "h-6 w-6" : "h-5 w-5";
  const navButtonClass = size === "large" ? "h-11 w-11 p-0" : "h-8 w-8 p-0";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onPrevious}
        disabled={!hasPrevious}
        aria-label="Previous track"
        className={navButtonClass}
      >
        <Icon name="arrow-left" className="h-4 w-4" />
      </Button>
      <Button
        variant="default"
        size="lg"
        onClick={onTogglePlayPause}
        disabled={isAudioLoading}
        aria-label={isPlaying ? "Pause" : "Play"}
        className={playButtonClass}
      >
        <Icon
          name={isPlaying ? "pause" : "play"}
          className={`${playIconClass} ${isPlaying ? "" : "ml-0.5"}`}
        />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        aria-label="Next track"
        className={navButtonClass}
      >
        <Icon name="arrow-right" className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface PlayerLoopShuffleDownloadProps {
  loopMode: "off" | "all" | "one";
  isShuffleEnabled: boolean;
  isDownloading?: boolean;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
  onDownload?: () => void;
  buttonClassName?: string;
}

function PlayerLoopShuffleDownload({
  loopMode,
  isShuffleEnabled,
  isDownloading = false,
  onToggleLoop,
  onToggleShuffle,
  onDownload,
  buttonClassName = "h-8 w-8 p-0",
}: PlayerLoopShuffleDownloadProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleLoop}
        aria-label={`Loop: ${loopMode === "off" ? "off" : loopMode === "all" ? "all" : "one"}`}
        className={cn(
          buttonClassName,
          "relative",
          loopMode === "off"
            ? "text-muted-foreground hover:text-foreground hover:bg-muted"
            : "text-primary bg-primary/10 hover:bg-primary/20",
        )}
        title={`Loop: ${loopMode === "off" ? "Off" : loopMode === "all" ? "All tracks" : "One track"}`}
      >
        <Icon name="arrow-path" className="h-4 w-4" />
        {loopMode === "one" && (
          <span
            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center leading-none"
            aria-label="Looping one track"
          >
            1
          </span>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleShuffle}
        aria-label={`Shuffle: ${isShuffleEnabled ? "on" : "off"}`}
        className={cn(
          buttonClassName,
          isShuffleEnabled
            ? "text-primary bg-primary/10 hover:bg-primary/20"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
        title={`Shuffle: ${isShuffleEnabled ? "On" : "Off"}`}
      >
        <Icon name="shuffle" className="h-4 w-4" />
      </Button>
      {onDownload && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDownload}
          disabled={isDownloading}
          aria-label="Download track"
          className={cn(
            buttonClassName,
            "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Download"
        >
          <Icon
            name={isDownloading ? "arrow-path" : "download"}
            className={`h-4 w-4 ${isDownloading ? "animate-spin" : ""}`}
          />
        </Button>
      )}
    </>
  );
}

export { PlayerLoopShuffleDownload, PlayerSeekBar, PlayerTransportControls };

import { useRef, useState } from "react";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { AddToPlaylistMenu } from "#app/components/add-to-playlist-menu";
import { MarqueeText } from "#app/components/marquee-text";
import { TrackDetailsDialog } from "#app/components/track-details-dialog";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#app/components/ui/sheet";
import { toast } from "#app/components/ui/use-toast.ts";
import { useSwipeGesture } from "#app/hooks/use-swipe-gesture";
import { type FullTrack } from "#app/types/frontend/shared";
import { nowPlayingCoverPixelSize } from "#app/utils/cover-image-url.ts";
import { getPlaybackProgressPercent } from "./audio-player-format";
import {
  PlayerLoopShuffleDownload,
  PlayerSeekBar,
  PlayerTransportControls,
} from "./player-controls";
import { QueueSheet } from "./player-queue-sheet";
import { PlayerTrackIdentity } from "./player-track-identity";
import { isSleepTimerMenuTarget, SleepTimerControl } from "./sleep-timer-control";

type Track = FullTrack;

interface PlayerChromeProps {
  track: Track;
  isPlaying: boolean;
  isAudioLoading: boolean;
  currentTime: number;
  duration: number;
  loopMode: "off" | "all" | "one";
  isShuffleEnabled: boolean;
  isDownloading: boolean;
  sleepTimerLabel: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
  isMuted: boolean;
  volume: number;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlayPause: () => void;
  onToggleLoop: () => void;
  onToggleShuffle: () => void;
  onClose: () => void;
  onDownload: () => void;
  onSeek: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  onVolumeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleMute: () => void;
  onStartSleepTimer: (minutes: number) => void;
  onClearSleepTimer: () => void;
}

interface PlayerMiniBarProps extends PlayerChromeProps {
  onOpenNowPlaying: () => void;
}

function PlayerMiniBar({
  track,
  isPlaying,
  isAudioLoading,
  currentTime,
  duration,
  hasNext,
  hasPrevious,
  onPrevious,
  onNext,
  onTogglePlayPause,
  onClose,
  onOpenNowPlaying,
}: PlayerMiniBarProps) {
  const progress = getPlaybackProgressPercent(currentTime, duration);
  const miniBarRef = useRef<HTMLDivElement>(null);
  const { offsetX, isSwiping } = useSwipeGesture(miniBarRef, {
    onSwipeLeft: hasNext ? onNext : undefined,
    onSwipeRight: hasPrevious ? onPrevious : undefined,
    enabled: hasNext || hasPrevious,
  });

  return (
    <div
      ref={miniBarRef}
      className="md:hidden"
      data-testid="player-mini-bar"
      style={{
        transform: `translateX(${offsetX}px)`,
        transition: isSwiping ? "none" : "transform 0.2s ease-out",
      }}
    >
      <div
        className="h-0.5 w-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Playback progress"
      >
        <div
          className="h-full bg-primary transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onOpenNowPlaying}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label="Open now playing"
        >
          <TrackThumbnail
            coverImage={track.coverImage}
            alt={track.title}
            size="md"
            className="shadow-md shrink-0"
          />
          <div className="min-w-0 flex-1">
            <MarqueeText className="text-sm font-semibold">{track.title}</MarqueeText>
            <MarqueeText className="text-xs text-muted-foreground">{track.artist.name}</MarqueeText>
          </div>
        </button>
        <Button
          variant="default"
          size="lg"
          onClick={onTogglePlayPause}
          disabled={isAudioLoading}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="h-11 w-11 shrink-0 rounded-full p-0"
        >
          <Icon
            name={isPlaying ? "pause" : "play"}
            className={`h-5 w-5 ${isPlaying ? "" : "ml-0.5"}`}
          />
        </Button>
        <QueueSheet
          triggerClassName="h-11 w-11 shrink-0 p-0"
          isPlaying={isPlaying}
          onTogglePlayPause={onTogglePlayPause}
        />
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
  );
}

interface PlayerNowPlayingSheetProps extends PlayerChromeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PlayerNowPlayingSheet({
  open,
  onOpenChange,
  track,
  isPlaying,
  isAudioLoading,
  currentTime,
  duration,
  loopMode,
  isShuffleEnabled,
  isDownloading,
  sleepTimerLabel,
  hasNext,
  hasPrevious,
  onPrevious,
  onNext,
  onTogglePlayPause,
  onToggleLoop,
  onToggleShuffle,
  onDownload,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onStartSleepTimer,
  onClearSleepTimer,
}: PlayerNowPlayingSheetProps) {
  const { playNextTrack, addToUpNext, addToQueue } = useAudioPlayer();
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPlaylistSheetOpen, setIsPlaylistSheetOpen] = useState(false);

  const hasAudioFiles = track.audioFiles != null && track.audioFiles.length > 0;

  const doQueueAction = (action: () => void, description: string) => {
    if (!hasAudioFiles) return;
    action();
    toast({
      title: "Success",
      description,
      variant: "success",
    });
    setIsOverflowOpen(false);
  };

  const handlePlayNext = () => {
    doQueueAction(() => playNextTrack(track), `"${track.title}" will play next`);
  };

  const handleAddToUpNext = () => {
    doQueueAction(() => addToUpNext(track), `"${track.title}" added to up next`);
  };

  const handleAddToQueue = () => {
    doQueueAction(() => addToQueue(track), `"${track.title}" added to queue`);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          inert={isDetailsOpen ? true : undefined}
          className={`flex max-h-[85vh] flex-col gap-6${isDetailsOpen ? " z-40" : ""}`}
          data-testid="player-now-playing-sheet"
          onPointerDownOutside={(event) => {
            // The sleep-timer menu is portaled outside this sheet. A tap on a
            // preset is "outside" the dialog and would dismiss now-playing
            // before the duration is applied.
            if (isSleepTimerMenuTarget(event.target)) event.preventDefault();
          }}
        >
          <SheetHeader className="flex-shrink-0 text-left">
            <SheetTitle>Now playing</SheetTitle>
            <SheetDescription className="sr-only">
              Expanded playback controls for the current track
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col items-center gap-4">
            <TrackThumbnail
              coverImage={track.coverImage}
              alt={track.title}
              size="lg"
              pixelSize={nowPlayingCoverPixelSize}
              loading="eager"
              className="shadow-lg h-40 w-40"
            />
            <div className="w-full text-center">
              <PlayerTrackIdentity
                track={track}
                titleClassName="text-lg font-semibold"
                artistClassName="text-sm text-muted-foreground"
                onNavigate={() => onOpenChange(false)}
              />
            </div>
          </div>
          <PlayerSeekBar
            currentTime={currentTime}
            duration={duration}
            onSeek={onSeek}
            onSeekStart={onSeekStart}
            onSeekEnd={onSeekEnd}
          />
          <div className="flex items-center justify-center gap-2">
            <div className="flex-1" />
            <PlayerTransportControls
              isPlaying={isPlaying}
              isAudioLoading={isAudioLoading}
              hasNext={hasNext}
              hasPrevious={hasPrevious}
              onPrevious={onPrevious}
              onNext={onNext}
              onTogglePlayPause={onTogglePlayPause}
              size="large"
            />
            <div className="flex-1 flex justify-end">
              <QueueSheet
                triggerClassName="h-11 w-11 shrink-0 p-0"
                isPlaying={isPlaying}
                onTogglePlayPause={onTogglePlayPause}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-1">
            <PlayerLoopShuffleDownload
              loopMode={loopMode}
              isShuffleEnabled={isShuffleEnabled}
              onToggleLoop={onToggleLoop}
              onToggleShuffle={onToggleShuffle}
              buttonClassName="h-11 w-11 p-0"
            />
            <Sheet open={isPlaylistSheetOpen} onOpenChange={setIsPlaylistSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Add to playlist"
                  title="Add to playlist"
                >
                  <Icon name="plus" className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="flex max-h-[60vh] flex-col overflow-y-auto"
                data-testid="player-add-to-playlist-sheet"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <SheetHeader className="text-left flex-shrink-0">
                  <SheetTitle>Add to playlist</SheetTitle>
                  <SheetDescription className="sr-only">
                    Add this track to one of your playlists
                  </SheetDescription>
                </SheetHeader>
                <AddToPlaylistMenu constrainHeight trackId={track.id} trackTitle={track.title} />
              </SheetContent>
            </Sheet>
            <SleepTimerControl
              sleepTimerLabel={sleepTimerLabel}
              onStart={onStartSleepTimer}
              onClear={onClearSleepTimer}
              triggerClassName="h-11 w-11 p-0"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOverflowOpen(true)}
              aria-label="More actions"
              className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              title="More actions"
            >
              <Icon name="dots-horizontal" className="h-4 w-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isOverflowOpen} onOpenChange={setIsOverflowOpen}>
        <SheetContent side="bottom" className="flex flex-col gap-2">
          <SheetHeader className="text-left">
            <SheetTitle>Track actions</SheetTitle>
            <SheetDescription className="sr-only">
              Additional actions for the current track
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handlePlayNext}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
            >
              <Icon name="play" className="h-5 w-5" />
              <span className="text-sm">Play Next</span>
            </button>
            <button
              type="button"
              onClick={handleAddToUpNext}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
            >
              <Icon name="arrow-right" className="h-5 w-5" />
              <span className="text-sm">Add to Up Next</span>
            </button>
            <button
              type="button"
              onClick={handleAddToQueue}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
            >
              <Icon name="list-bullet" className="h-5 w-5" />
              <span className="text-sm">Add to Queue</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOverflowOpen(false);
                setIsDetailsOpen(true);
              }}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors"
            >
              <Icon name="eye-open" className="h-5 w-5" />
              <span className="text-sm">Track Details</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onDownload();
                setIsOverflowOpen(false);
              }}
              disabled={isDownloading}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Icon
                name={isDownloading ? "arrow-path" : "download"}
                className={`h-5 w-5 ${isDownloading ? "animate-spin" : ""}`}
              />
              <span className="text-sm">Download</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <TrackDetailsDialog trackId={track.id} open={isDetailsOpen} onOpenChange={setIsDetailsOpen} />
    </>
  );
}

function PlayerDesktopBar({
  track,
  isPlaying,
  isAudioLoading,
  currentTime,
  duration,
  loopMode,
  isShuffleEnabled,
  isDownloading,
  sleepTimerLabel,
  hasNext,
  hasPrevious,
  isMuted,
  volume,
  onPrevious,
  onNext,
  onTogglePlayPause,
  onToggleLoop,
  onToggleShuffle,
  onClose,
  onDownload,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onVolumeChange,
  onToggleMute,
  onStartSleepTimer,
  onClearSleepTimer,
}: PlayerChromeProps) {
  return (
    <div className="hidden min-w-0 items-center gap-4 md:flex" data-testid="player-desktop-bar">
      <div className="flex min-w-0 flex-1 max-w-xs items-center gap-3 lg:max-w-sm">
        <TrackThumbnail
          coverImage={track.coverImage}
          alt={track.title}
          size="lg"
          className="shadow-md shrink-0"
        />
        <PlayerTrackIdentity
          track={track}
          titleClassName="text-sm font-semibold"
          artistClassName="text-xs text-muted-foreground"
          className="flex-1"
        />
      </div>

      <div className="flex min-w-0 max-w-2xl flex-1 flex-col items-center gap-2">
        <PlayerTransportControls
          isPlaying={isPlaying}
          isAudioLoading={isAudioLoading}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          onPrevious={onPrevious}
          onNext={onNext}
          onTogglePlayPause={onTogglePlayPause}
        />
        <PlayerSeekBar
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          onSeekStart={onSeekStart}
          onSeekEnd={onSeekEnd}
        />
      </div>

      <div className="hidden items-center gap-2 md:flex">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="h-8 w-8 p-0"
          title={isMuted ? "Unmute (M)" : "Mute (M)"}
        >
          <Icon
            name={isMuted || volume === 0 ? "speaker-x-mark" : "speaker-wave"}
            className="h-4 w-4"
          />
        </Button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={isMuted ? 0 : volume}
          onChange={onVolumeChange}
          className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
          aria-label="Volume"
        />
      </div>
      <SleepTimerControl
        sleepTimerLabel={sleepTimerLabel}
        onStart={onStartSleepTimer}
        onClear={onClearSleepTimer}
      />
      <div className="flex shrink-0 items-center gap-1">
        <QueueSheet isPlaying={isPlaying} onTogglePlayPause={onTogglePlayPause} />
        <PlayerLoopShuffleDownload
          loopMode={loopMode}
          isShuffleEnabled={isShuffleEnabled}
          isDownloading={isDownloading}
          onToggleLoop={onToggleLoop}
          onToggleShuffle={onToggleShuffle}
          onDownload={onDownload}
        />
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
  );
}

export { PlayerDesktopBar, PlayerMiniBar, PlayerNowPlayingSheet };
export type { PlayerChromeProps };

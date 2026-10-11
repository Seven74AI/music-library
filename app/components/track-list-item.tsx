import {
  useState,
  useCallback,
  useEffect,
  useSyncExternalStore,
  memo,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link, useFetcher } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { FlagForReviewDialog } from "#app/components/flag-for-review-dialog.tsx";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import { Checkbox } from "#app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#app/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "#app/components/ui/dropdown-menu.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "#app/components/ui/sheet.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#app/components/ui/tooltip";
import { toast } from "#app/components/ui/use-toast.ts";
import {
  useOfflineTrackDownload,
  type OfflineDownloadTrack,
} from "#app/hooks/use-offline-track-download.ts";
import { useTrackAudioFileDownload } from "#app/hooks/use-track-audio-file-download.ts";
import { type DiscoverSortOption } from "#app/utils/discover.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { isPlayableTrack } from "#app/utils/playable-track";
import { formatServiceDateAdded } from "#app/utils/service-date.ts";
import { type TrackPopularityStats } from "#app/utils/discover.ts";
import { formatPopularityStats } from "#app/utils/popularity-format.ts";
import { useIsMobile } from "#app/utils/use-mobile.ts";
import { useOptionalUser, userIsCuratorOrAdmin } from "#app/utils/user.ts";
import { AddToPlaylistMenu } from "./add-to-playlist-menu";
import { NotesBadge } from "./notes-badge";
import { AddToRoomQueueAction } from "./party-room/add-to-room-queue-action";
import { ReportIssueDialog } from "./report-issue-dialog";
import { useMetadataClipboard } from "./metadata-clipboard.tsx";
import { TrackDetailsDialog } from "./track-details-dialog";
import {
  clearRestoredTrackDialog,
  getRestoredDialogs,
  getServerRestoredDialogs,
  subscribeRestoredDialogs,
} from "#app/features/curator/session-restore.ts";

interface TrackListItemData {
  id: string;
  title: string;
  artist: { id: string; name: string };
  duration: number | null;
  coverImage: { objectKey: string } | null;
  thumbnailUrl?: string | null; // Placeholder thumbnail URL (e.g., from YouTube) when coverImage is not available
  serviceUrl: string | null;
  service?: { displayName: string; logoUrl: string | null } | null;
  audioFiles?: Array<{ id: string; format: string | null; objectKey: string }>;
  album?: { id: string; name: string } | null;
  isInUserLibrary?: boolean;
  releaseDate?: string | Date | null;
  originalDate?: string | Date | null;
  createdAt?: string | Date | null;
  popularityStats?: TrackPopularityStats;
}

interface UserTrack {
  createdAt: string | Date;
}

interface TrackListItemProps {
  track: TrackListItemData;
  userTrack: UserTrack;
  index: number;
  playlistContext?: {
    type:
      | "library"
      | "playlist"
      | "artist"
      | "album"
      | "track"
      | "music"
      | "discover"
      | "onRepeatSnapshot";
    playlistId?: string;
    artistId?: string;
    albumId?: string;
    trackId?: string;
    sort?: "custom" | "title" | "artist" | "duration" | "dateAdded";
    librarySort?: "dateAdded" | "mostPlayedMonth" | "mostPlayedEver";
    discoverSort?: DiscoverSortOption;
    sortDirection?: "asc" | "desc";
    snapshotId?: string;
  };
  isDeleted?: boolean;
  showQueueActions?: boolean;
  onRemoveFromQueue?: (trackId: string) => void;
  showPlaylistActions?: boolean;
  onRemoveFromPlaylist?: (trackId: string) => void;
  playlists?: Array<{
    id: string;
    title: string;
    description: string | null;
    _count: { tracks: number };
  }>;
  showDuration?: boolean; // New prop to control duration display
  variant?: "default" | "compact";
  showQuickAddToPlaylist?: boolean;
  /** Visible control beside add-to-playlist. Hidden once the track is saved. */
  showAddToLibrary?: boolean;
  /** When false, playTrack resolves spine position by track id instead of list index */
  usePlaybackIndex?: boolean;
  /** Render prop for custom per-track action buttons. Receives trackId, isInLibrary, and isDeleted. */
  itemActions?: (props: { trackId: string; isInLibrary: boolean; isDeleted: boolean }) => ReactNode;
  /** Static per-track action content; preferred over itemActions when both are set. */
  itemActionsContent?: ReactNode;
  /** When true, "Download" saves the audio file to disk (browser download) inside the three-dot menu */
  showAudioFileDownload?: boolean;
  /** When set, offline pin/remove actions appear inside the three-dot menu (PWA offline storage) */
  offlineDownloadTrack?: OfflineDownloadTrack;
  offlineDownloadPlaylistId?: string;
  /** When true, show a checkbox for bulk selection */
  showCheckbox?: boolean;
  /** When true, the track is selected */
  isSelected?: boolean;
  /** Callback when checkbox is toggled */
  onToggleSelection?: (trackId: string) => void;
  /** Curator notes on this track. The badge stays hidden when this is 0. */
  curatorNotesCount?: number;
  /**
   * When true, "View track details" opens the curator metadata editor
   * (`TrackDetailsDialog`) instead of the read-only details view.
   * Library passes this for curators and admins.
   */
  isCurator?: boolean;
}

/**
 * Individual track list item component with responsive menu system
 *
 * On mobile: Uses bottom sheets for track actions (Spotify-like UX)
 * On desktop: Uses dropdown menus for track actions
 *
 * Features:
 * - Play/pause functionality with visual feedback
 * - Track thumbnail and metadata display
 * - Responsive action menu (sheet on mobile, dropdown on desktop)
 * - Add to playlist functionality with duplicate detection
 * - External link actions
 * - Report Issue for any signed-in user
 *
 * @param track - Track data including title, artist, duration, etc.
 * @param userTrack - User-specific track data (creation date, etc.)
 * @param index - Position in the list (for numbering)
 * @param playlistContext - Context for playlist-specific actions
 * @param showQueueActions - Whether to show queue-related actions
 * @param onRemoveFromQueue - Callback for removing track from queue
 * @param playlists - Available playlists for "Add to Playlist" functionality
 * @param itemActions - Optional render prop for custom per-track action buttons
 *
 * @example
 * ```tsx
 * <TrackListItem
 *   track={trackData}
 *   userTrack={userTrackData}
 *   index={0}
 *   playlists={userPlaylists}
 * />
 * ```
 */
export const TrackListItem = memo(function TrackListItem({
  track,
  userTrack: _userTrack,
  index,
  playlistContext,
  isDeleted,
  showQueueActions,
  onRemoveFromQueue,
  showPlaylistActions,
  onRemoveFromPlaylist,
  playlists,
  showDuration = true,
  variant = "default",
  showQuickAddToPlaylist = false,
  showAddToLibrary = false,
  usePlaybackIndex = true,
  itemActions,
  itemActionsContent,
  showAudioFileDownload = false,
  offlineDownloadTrack,
  offlineDownloadPlaylistId,
  showCheckbox = false,
  isSelected = false,
  onToggleSelection,
  curatorNotesCount = 0,
  isCurator = false,
}: TrackListItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false);
  const [isPlaylistSheetOpen, setIsPlaylistSheetOpen] = useState(false);
  const [isDetailsSheetOpen, setIsDetailsSheetOpen] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [isFlagDialogOpen, setIsFlagDialogOpen] = useState(false);
  const [addedToLibrary, setAddedToLibrary] = useState(false);
  const libraryFetcher = useFetcher();
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorRestore, setEditorRestore] = useState<{
    tab?: string;
    unsavedChanges?: Record<string, unknown>;
  } | null>(null);
  const isMobile = useIsMobile();
  const clipboard = useMetadataClipboard(track.id);
  const restoredDialogs = useSyncExternalStore(
    subscribeRestoredDialogs,
    getRestoredDialogs,
    getServerRestoredDialogs,
  );
  const restoredTrackDialog = restoredDialogs.find(
    (dialog) => dialog.dialogType === "track-edit" && dialog.entityId === track.id,
  );
  const user = useOptionalUser();
  const canFlagForReview = userIsCuratorOrAdmin(user);
  const { currentTrack, currentIndex, playTrack, playNextTrack, addToUpNext, addToQueue } =
    useAudioPlayer();

  const handleRemoveFromQueue = useCallback(() => {
    if (onRemoveFromQueue) {
      onRemoveFromQueue(track.id);
    }
  }, [track.id, onRemoveFromQueue]);

  const handleOpenPlaylistSheet = useCallback(() => {
    setIsActionsSheetOpen(false);
    setIsPlaylistSheetOpen(true);
  }, []);

  const handlePlaylistSuccess = useCallback(() => {
    setIsPlaylistSheetOpen(false);
  }, []);

  const handleOpenDetailsSheet = useCallback(() => {
    setIsActionsSheetOpen(false);
    setIsDetailsSheetOpen(true);
  }, []);

  const handleOpenReportDialog = useCallback(() => {
    setIsActionsSheetOpen(false);
    // Opening a dialog in the same turn as a menu or sheet close loops Radix
    // focus restoration. On mobile, also wait for the sheet close animation so
    // its overlay does not cover the dialog.
    window.setTimeout(
      () => {
        setIsReportDialogOpen(true);
      },
      isMobile ? 300 : 0,
    );
  }, [isMobile]);

  // Open after the menu or sheet finishes closing. Opening a dialog in the same
  // turn as a Radix menu close traps focus in a loop.
  const openFlagDialog = useCallback(() => {
    window.setTimeout(() => setIsFlagDialogOpen(true), 0);
  }, []);

  const handleOpenTrackEditor = useCallback(() => {
    setIsActionsSheetOpen(false);
    setIsEditorOpen(true);
  }, []);

  const openPasteMetadata = useCallback(() => {
    setIsActionsSheetOpen(false);
    clipboard.openPaste(isMobile ? 300 : 0);
  }, [clipboard, isMobile]);

  useEffect(() => {
    if (!isCurator || !restoredTrackDialog) return;
    setEditorRestore({
      tab: restoredTrackDialog.tab,
      unsavedChanges: restoredTrackDialog.unsavedChanges,
    });
    setIsEditorOpen(true);
    clearRestoredTrackDialog(track.id);
  }, [isCurator, restoredTrackDialog, track.id]);

  const hasAudioFiles = isPlayableTrack({ audioFiles: track.audioFiles, isDeleted });
  const showArchiving = !isDeleted && (track.audioFiles?.length ?? 0) === 0;
  const showLibraryButton = showAddToLibrary && track.isInUserLibrary === false && !addedToLibrary;
  const canDownloadAudio = showAudioFileDownload || addedToLibrary;

  useEffect(() => {
    setAddedToLibrary(false);
  }, [track.id, track.isInUserLibrary]);

  useEffect(() => {
    const result = libraryFetcher.data;
    if (!result || libraryFetcher.state !== "idle" || typeof result !== "object") return;
    if ("status" in result && result.status === "error") setAddedToLibrary(false);
  }, [libraryFetcher.data, libraryFetcher.state]);

  const handleAddToLibrary = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (libraryFetcher.state !== "idle") return;
      setAddedToLibrary(true);
      void libraryFetcher.submit(
        { trackId: track.id, action: "add" },
        { method: "post", action: "/resources/track-library" },
      );
    },
    [libraryFetcher, track.id],
  );

  // Radix dropdowns portal outside the row. React still bubbles events through the
  // portal's React tree (not the DOM tree), so dropdown content must stopPropagation /
  // preventDefault or the row's onClick=play would fire.
  // Mobile sheets avoid this by rendering as siblings of the row (see below) — overlay
  // dismiss cannot be fixed with stopPropagation on SheetContent alone (Overlay is a sibling).
  // See: https://github.com/radix-ui/primitives/issues/1242
  //      https://github.com/radix-ui/primitives/issues/2267
  //      https://github.com/radix-ui/primitives/issues/3099
  //      https://react.dev/reference/react-dom/createPortal#handling-events-from-a-portal
  const handleMenuPointerDown = useCallback((event: PointerEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // Backup click guard for nested dropdown portals.
  const handleMenuClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const handlePlayTrack = useCallback(() => {
    if (!hasAudioFiles) {
      return;
    }
    const context = playlistContext || { type: "library" as const };
    if (usePlaybackIndex) {
      playTrack(track, context, index);
      return;
    }
    playTrack(track, context);
  }, [hasAudioFiles, track, playlistContext, index, playTrack, usePlaybackIndex]);

  const handleQuickAddToPlaylist = useCallback(() => {
    if (isMobile) {
      setIsPlaylistSheetOpen(true);
    }
  }, [isMobile]);

  const handlePlayNext = useCallback(() => {
    if (!hasAudioFiles) return;

    playNextTrack(track);
    toast({
      title: "Success",
      description: `"${track.title}" will play next`,
      variant: "success",
    });
    setIsActionsSheetOpen(false);
  }, [hasAudioFiles, playNextTrack, track]);

  const handleAddToUpNext = useCallback(() => {
    if (!hasAudioFiles) return;

    addToUpNext(track);
    toast({
      title: "Success",
      description: `"${track.title}" added to up next`,
      variant: "success",
    });
    setIsActionsSheetOpen(false);
  }, [hasAudioFiles, addToUpNext, track]);

  const handleAddToQueue = useCallback(() => {
    if (!hasAudioFiles) return;

    addToQueue(track);
    toast({
      title: "Success",
      description: `"${track.title}" added to queue`,
      variant: "success",
    });
    setIsActionsSheetOpen(false);
  }, [hasAudioFiles, addToQueue, track]);

  // Check if this track is currently playing (both ID and position must match for duplicates)
  const isCurrentlyPlaying = usePlaybackIndex
    ? currentTrack?.id === track.id && currentIndex === index
    : currentTrack?.id === track.id;

  const isCompact = variant === "compact";
  const rowClassName = isCompact
    ? "group flex items-center gap-3 rounded-lg px-1 py-2.5 sm:px-3 hover:bg-muted/50 transition-colors min-h-14"
    : "group flex items-center gap-3 px-1 py-2 sm:gap-4 sm:px-4 rounded-md hover:bg-muted/50 transition-colors min-h-20";

  const serviceDateAdded = formatServiceDateAdded({
    releaseDate: track.releaseDate,
    originalDate: track.originalDate,
    createdAt: track.createdAt ?? null,
  });

  return (
    <>
      <div
        className={`${rowClassName} ${isCurrentlyPlaying ? "bg-primary/5" : ""} ${
          isDeleted ? "opacity-60" : ""
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={hasAudioFiles ? handlePlayTrack : undefined}
        role="gridcell"
        aria-label={`Track ${index + 1}: ${track.title} by ${track.artist.name}${isDeleted ? " (Deleted from YouTube)" : ""}`}
        style={hasAudioFiles ? { cursor: "pointer" } : undefined}
      >
        {/* Checkbox for bulk selection */}
        {showCheckbox && (
          <div className="w-8 flex items-center justify-center min-w-8">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => {
                if (onToggleSelection) {
                  onToggleSelection(track.id);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Select ${track.title}`}
            />
          </div>
        )}

        {/* Track Number / Play Button */}
        {!isCompact && !showCheckbox && (
          <div className="w-8 flex items-center justify-center min-w-8">
            {hasAudioFiles && (isHovered || isCurrentlyPlaying) ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayTrack();
                }}
                aria-label={isCurrentlyPlaying ? "Pause track" : `Play ${track.title}`}
              >
                <Icon name={isCurrentlyPlaying ? "pause" : "play"} className="h-4 w-4" />
              </Button>
            ) : (
              <span
                className="text-sm text-muted-foreground group-hover:text-foreground transition-colors"
                aria-label={`Track number ${index + 1}`}
              >
                {index + 1}
              </span>
            )}
          </div>
        )}

        {/* Track Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            {/* Thumbnail */}
            <div className="flex-shrink-0">
              <TrackThumbnail
                coverImage={track.coverImage}
                thumbnailUrl={track.thumbnailUrl}
                alt={track.title}
                size="sm"
              />
            </div>

            {/* Title and Artist */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 truncate font-medium text-sm group-hover:text-foreground transition-colors">
                  {track.title}
                </div>
                <NotesBadge count={curatorNotesCount} onClick={() => setIsNotesOpen(true)} />
                {showArchiving ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Archiving
                  </span>
                ) : null}
                {isDeleted && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex-shrink-0">
                        <Icon
                          name="question-mark-circled"
                          className="h-4 w-4 text-muted-foreground"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This video has been deleted from YouTube</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {track.service?.displayName === "YouTube" && !isDeleted && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex-shrink-0">
                        <Icon name="youtube" className="h-4 w-4 text-red-500" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This track comes from YouTube</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {track.artist.name}
                {isDeleted && (
                  <span className="ml-2 text-muted-foreground/70">• Deleted from YouTube</span>
                )}
              </div>
              {track.album?.name ? (
                <Link
                  to={`/albums/${track.album.id}`}
                  className="block truncate text-xs text-muted-foreground hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {track.album.name}
                </Link>
              ) : null}
              {track.popularityStats && formatPopularityStats(track.popularityStats, true) && (
                <div className="text-xs text-muted-foreground/80 truncate">
                  {formatPopularityStats(track.popularityStats, true)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Duration */}
        {showDuration && (
          <div className="hidden md:flex text-xs text-muted-foreground w-12 text-center">
            {formatDuration(track.duration)}
          </div>
        )}

        {/* Actions */}
        <div
          className={`flex items-center gap-1 ${
            showQuickAddToPlaylist || showLibraryButton ? "shrink-0" : "w-8"
          }`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {showQuickAddToPlaylist &&
            playlists != null &&
            (isMobile ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Add to playlist"
                onClick={handleQuickAddToPlaylist}
              >
                <Icon name="plus" className="h-4 w-4" />
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label="Add to playlist"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onPointerDown={handleMenuPointerDown}
                  onClick={handleMenuClick}
                >
                  <AddToPlaylistMenu
                    trackId={track.id}
                    trackTitle={track.title}
                    playlists={playlists}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          {showLibraryButton ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2"
              aria-label="Add to library"
              disabled={libraryFetcher.state !== "idle"}
              onClick={handleAddToLibrary}
            >
              {libraryFetcher.state !== "idle" ? (
                <Icon name="update" className="h-4 w-4 animate-spin" />
              ) : (
                "Add to library"
              )}
            </Button>
          ) : null}
          {isMobile ? (
            /* Mobile: Bottom Sheet */
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="More actions"
              onClick={() => setIsActionsSheetOpen(true)}
            >
              <Icon name="dots-horizontal" className="h-4 w-4" />
            </Button>
          ) : (
            /* Desktop: Dropdown Menu */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="More actions">
                  <Icon name="dots-horizontal" className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onPointerDown={handleMenuPointerDown}
                onClick={handleMenuClick}
              >
                {isCurator ? (
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenTrackEditor();
                    }}
                  >
                    <Icon name="eye-open" className="h-4 w-4 mr-2" />
                    View track details
                  </DropdownMenuItem>
                ) : (
                  <Dialog>
                    <DialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Icon name="eye-open" className="h-4 w-4 mr-2" />
                        View track details
                      </DropdownMenuItem>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="text-left">
                          <div className="flex items-center gap-3">
                            <TrackThumbnail
                              coverImage={track.coverImage}
                              thumbnailUrl={track.thumbnailUrl}
                              alt={track.title}
                              size="md"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm truncate" title={track.title}>
                                {track.title}
                              </div>
                              <div
                                className="text-xs text-muted-foreground truncate"
                                title={track.artist.name}
                              >
                                {track.artist.name}
                              </div>
                            </div>
                          </div>
                        </DialogTitle>
                      </DialogHeader>
                      <div className="mt-6 space-y-4">
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Track Information</div>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <div>Artist: {track.artist.name}</div>
                            <div>Duration: {formatDuration(track.duration)}</div>
                            {track.album?.name ? <div>Album: {track.album.name}</div> : null}
                            {track.service?.displayName && (
                              <div>Source: {track.service.displayName}</div>
                            )}
                            {serviceDateAdded && <div>Date added: {serviceDateAdded}</div>}
                          </div>
                        </div>
                        {track.serviceUrl && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                track.serviceUrl && window.open(track.serviceUrl, "_blank")
                              }
                              className="flex-1"
                            >
                              <Icon name="link-2" className="h-4 w-4 mr-2" />
                              Open on YouTube
                            </Button>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
                {canFlagForReview ? (
                  <>
                    <DropdownMenuItem
                      className="min-h-11"
                      onSelect={() => {
                        void clipboard.copy();
                      }}
                    >
                      <Icon name="file-text" className="mr-2 h-4 w-4" />
                      Copy Metadata
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onSelect={openPasteMetadata}>
                      <Icon name="pencil-1" className="mr-2 h-4 w-4" />
                      Paste Metadata
                    </DropdownMenuItem>
                  </>
                ) : null}
                {user ? (
                  <DropdownMenuItem onSelect={handleOpenReportDialog}>
                    <Icon name="question-mark-circled" className="h-4 w-4 mr-2" />
                    Report Issue
                  </DropdownMenuItem>
                ) : null}
                {canFlagForReview && (
                  <DropdownMenuItem onSelect={openFlagDialog}>
                    <Icon name="file-text" className="h-4 w-4 mr-2" />
                    Flag for review
                  </DropdownMenuItem>
                )}
                {track.serviceUrl && (
                  <DropdownMenuItem asChild>
                    <a
                      href={track.serviceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center"
                    >
                      <Icon name="link-2" className="h-4 w-4 mr-2" />
                      Open on YouTube
                    </a>
                  </DropdownMenuItem>
                )}
                {playlists != null && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Icon name="plus" className="h-4 w-4 mr-2" />
                      Add to Playlist
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      onPointerDown={handleMenuPointerDown}
                      onClick={handleMenuClick}
                    >
                      <AddToPlaylistMenu
                        trackId={track.id}
                        trackTitle={track.title}
                        playlists={playlists}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {hasAudioFiles && (
                  <>
                    <DropdownMenuItem onClick={handlePlayNext}>
                      <Icon name="arrow-right" className="h-4 w-4 mr-2" />
                      Play next
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddToUpNext}>
                      <Icon name="list-bullet" className="h-4 w-4 mr-2" />
                      Add to up next
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddToQueue}>
                      <Icon name="plus" className="h-4 w-4 mr-2" />
                      Add to queue
                    </DropdownMenuItem>
                    <AddToRoomQueueAction trackId={track.id} variant="dropdown" />
                  </>
                )}
                {canDownloadAudio && hasAudioFiles ? (
                  <AudioFileDownloadDropdownItem trackId={track.id} title={track.title} />
                ) : null}
                {offlineDownloadTrack ? (
                  <OfflineDownloadDropdownItem
                    track={offlineDownloadTrack}
                    playlistId={offlineDownloadPlaylistId}
                  />
                ) : null}
                {showQueueActions && (
                  <DropdownMenuItem onClick={handleRemoveFromQueue}>
                    <Icon name="trash" className="h-4 w-4 mr-2" />
                    Remove from Queue
                  </DropdownMenuItem>
                )}
                {showPlaylistActions && onRemoveFromPlaylist && (
                  <DropdownMenuItem onClick={() => onRemoveFromPlaylist(track.id)}>
                    <Icon name="trash" className="h-4 w-4 mr-2" />
                    Remove from Playlist
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Custom actions from render prop */}
        <div onClick={(e) => e.stopPropagation()}>
          {itemActionsContent ??
            itemActions?.({
              trackId: track.id,
              isInLibrary: !!track.isInUserLibrary,
              isDeleted: !!isDeleted,
            })}
        </div>
      </div>

      {/*
        Mobile sheets must be siblings of the row, not children of the onClick=play node.
        Sheet overlay/content portal to document.body, but React still bubbles events through
        this component tree (https://github.com/radix-ui/primitives/issues/1242,
        https://react.dev/reference/react-dom/createPortal#handling-events-from-a-portal).
        If the Sheet is under the row div, tapping the dimmed overlay to dismiss fires the
        row's play handler. stopPropagation on SheetContent does not cover the Overlay sibling.
      */}
      {curatorNotesCount > 0 ? (
        <TrackDetailsDialog
          trackId={track.id}
          open={isNotesOpen}
          onOpenChange={setIsNotesOpen}
          initialTab="notes"
        />
      ) : null}

      {isMobile && (
        <>
          {/* Actions Sheet */}
          <Sheet open={isActionsSheetOpen} onOpenChange={setIsActionsSheetOpen}>
            <SheetContent
              side="bottom"
              className="flex h-[60vh] flex-col gap-0 overflow-hidden"
              data-testid="track-actions-sheet"
            >
              <SheetHeader className="shrink-0">
                <SheetTitle className="text-left">
                  <div className="flex items-center gap-3">
                    <TrackThumbnail
                      coverImage={track.coverImage}
                      thumbnailUrl={track.thumbnailUrl}
                      alt={track.title}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate" title={track.title}>
                        {track.title}
                      </div>
                      <div
                        className="text-xs text-muted-foreground truncate"
                        title={track.artist.name}
                      >
                        {track.artist.name}
                      </div>
                    </div>
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div
                className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto"
                data-testid="track-actions-scroll"
              >
                <Button
                  variant="ghost"
                  className="w-full justify-start h-12 text-base"
                  onClick={isCurator ? handleOpenTrackEditor : handleOpenDetailsSheet}
                >
                  <Icon name="eye-open" className="h-5 w-5 mr-3" />
                  View track details
                </Button>
                {canFlagForReview ? (
                  <>
                    <Button
                      variant="ghost"
                      className="h-12 w-full justify-start text-base"
                      onClick={() => {
                        setIsActionsSheetOpen(false);
                        void clipboard.copy();
                      }}
                    >
                      <Icon name="file-text" className="mr-3 h-5 w-5" />
                      Copy Metadata
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-12 w-full justify-start text-base"
                      onClick={openPasteMetadata}
                    >
                      <Icon name="pencil-1" className="mr-3 h-5 w-5" />
                      Paste Metadata
                    </Button>
                  </>
                ) : null}
                {user ? (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-base"
                    onClick={handleOpenReportDialog}
                  >
                    <Icon name="question-mark-circled" className="h-5 w-5 mr-3" />
                    Report Issue
                  </Button>
                ) : null}
                {canFlagForReview && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-base"
                    onClick={() => {
                      setIsActionsSheetOpen(false);
                      openFlagDialog();
                    }}
                  >
                    <Icon name="file-text" className="h-5 w-5 mr-3" />
                    Flag for review
                  </Button>
                )}
                {track.serviceUrl && (
                  <Button variant="ghost" className="w-full justify-start h-12 text-base" asChild>
                    <a href={track.serviceUrl} target="_blank" rel="noopener noreferrer">
                      <Icon name="link-2" className="h-5 w-5 mr-3" />
                      Open on YouTube
                    </a>
                  </Button>
                )}
                {playlists != null && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-base"
                    onClick={handleOpenPlaylistSheet}
                  >
                    <Icon name="plus" className="h-5 w-5 mr-3" />
                    Add to Playlist
                  </Button>
                )}
                {hasAudioFiles && (
                  <>
                    <Button
                      variant="ghost"
                      className="w-full justify-start h-12 text-base"
                      onClick={handlePlayNext}
                    >
                      <Icon name="arrow-right" className="h-5 w-5 mr-3" />
                      Play next
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start h-12 text-base"
                      onClick={handleAddToUpNext}
                    >
                      <Icon name="list-bullet" className="h-5 w-5 mr-3" />
                      Add to up next
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start h-12 text-base"
                      onClick={handleAddToQueue}
                    >
                      <Icon name="plus" className="h-5 w-5 mr-3" />
                      Add to queue
                    </Button>
                    <AddToRoomQueueAction
                      trackId={track.id}
                      variant="sheet"
                      onDone={() => setIsActionsSheetOpen(false)}
                    />
                  </>
                )}
                {canDownloadAudio && hasAudioFiles ? (
                  <AudioFileDownloadSheetButton
                    trackId={track.id}
                    title={track.title}
                    onDone={() => setIsActionsSheetOpen(false)}
                  />
                ) : null}
                {offlineDownloadTrack ? (
                  <OfflineDownloadSheetButton
                    track={offlineDownloadTrack}
                    playlistId={offlineDownloadPlaylistId}
                    onDone={() => setIsActionsSheetOpen(false)}
                  />
                ) : null}
                {showQueueActions && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-base"
                    onClick={() => {
                      handleRemoveFromQueue();
                      setIsActionsSheetOpen(false);
                    }}
                  >
                    <Icon name="trash" className="h-5 w-5 mr-3" />
                    Remove from Queue
                  </Button>
                )}
                {showPlaylistActions && onRemoveFromPlaylist && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-12 text-base"
                    onClick={() => {
                      onRemoveFromPlaylist(track.id);
                      setIsActionsSheetOpen(false);
                    }}
                  >
                    <Icon name="trash" className="h-5 w-5 mr-3" />
                    Remove from Playlist
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Playlist Selection Sheet */}
          <Sheet open={isPlaylistSheetOpen} onOpenChange={setIsPlaylistSheetOpen}>
            <SheetContent side="bottom" className="h-[80vh]">
              <SheetHeader>
                <SheetTitle>Add to Playlist</SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <AddToPlaylistMenu
                  trackId={track.id}
                  trackTitle={track.title}
                  playlists={playlists || []}
                  onSuccess={handlePlaylistSuccess}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Track Details Sheet (mobile) */}
          <Sheet open={isDetailsSheetOpen} onOpenChange={setIsDetailsSheetOpen}>
            <SheetContent side="bottom" className="h-[80vh]">
              <SheetHeader>
                <SheetTitle className="text-left">
                  <div className="flex items-center gap-3">
                    <TrackThumbnail
                      coverImage={track.coverImage}
                      thumbnailUrl={track.thumbnailUrl}
                      alt={track.title}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate" title={track.title}>
                        {track.title}
                      </div>
                      <div
                        className="text-xs text-muted-foreground truncate"
                        title={track.artist.name}
                      >
                        {track.artist.name}
                      </div>
                    </div>
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Track Information</div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Artist: {track.artist.name}</div>
                    <div>Duration: {formatDuration(track.duration)}</div>
                    {track.album?.name ? <div>Album: {track.album.name}</div> : null}
                    {track.service?.displayName && <div>Source: {track.service.displayName}</div>}
                    {serviceDateAdded && <div>Date added: {serviceDateAdded}</div>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {track.serviceUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => track.serviceUrl && window.open(track.serviceUrl, "_blank")}
                      className="flex-1"
                    >
                      <Icon name="link-2" className="h-4 w-4 mr-2" />
                      Open on YouTube
                    </Button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      {isReportDialogOpen ? (
        <ReportIssueDialog
          trackId={track.id}
          trackTitle={track.title}
          open={isReportDialogOpen}
          onOpenChange={setIsReportDialogOpen}
        />
      ) : null}
      {canFlagForReview && (
        <FlagForReviewDialog
          entityType="track"
          entityId={track.id}
          entityName={track.title}
          open={isFlagDialogOpen}
          onOpenChange={setIsFlagDialogOpen}
        />
      )}
      {/*
        Sibling of the row, same as the mobile sheets: the dialog portals to
        document.body, but React events still bubble through this tree. Keeping
        it outside the playable row means opening or using the editor does not
        start playback.
      */}
      {isCurator && isEditorOpen ? (
        <TrackDetailsDialog
          trackId={track.id}
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          initialTab={
            editorRestore?.tab === "extended" ||
            editorRestore?.tab === "history" ||
            editorRestore?.tab === "notes"
              ? editorRestore.tab
              : "basic"
          }
          initialDraft={editorRestore?.unsavedChanges ?? null}
        />
      ) : null}
      {clipboard.dialog}
    </>
  );
});

function AudioFileDownloadDropdownItem({ trackId, title }: { trackId: string; title: string }) {
  const { isDownloading, downloadAudioFile, label } = useTrackAudioFileDownload({
    id: trackId,
    title,
  });

  return (
    <DropdownMenuItem
      disabled={isDownloading}
      onClick={(event) => {
        event.preventDefault();
        void downloadAudioFile();
      }}
    >
      <Icon
        name={isDownloading ? "arrow-path" : "download"}
        className={`h-4 w-4 mr-2 ${isDownloading ? "animate-spin" : ""}`}
      />
      {label}
    </DropdownMenuItem>
  );
}

function AudioFileDownloadSheetButton({
  trackId,
  title,
  onDone,
}: {
  trackId: string;
  title: string;
  onDone: () => void;
}) {
  const { isDownloading, downloadAudioFile, label } = useTrackAudioFileDownload({
    id: trackId,
    title,
  });

  return (
    <Button
      variant="ghost"
      className="w-full justify-start h-12 text-base"
      disabled={isDownloading}
      onClick={() => {
        void downloadAudioFile().then(onDone);
      }}
    >
      <Icon
        name={isDownloading ? "arrow-path" : "download"}
        className={`h-5 w-5 mr-3 ${isDownloading ? "animate-spin" : ""}`}
      />
      {label}
    </Button>
  );
}

function OfflineDownloadDropdownItem({
  track,
  playlistId,
}: {
  track: OfflineDownloadTrack;
  playlistId?: string;
}) {
  const { hasAudio, isWorking, isBusy, label, iconName, toggleDownload } = useOfflineTrackDownload(
    track,
    playlistId,
  );
  if (!hasAudio) return null;

  return (
    <DropdownMenuItem
      disabled={isWorking || isBusy}
      onClick={(event) => void toggleDownload(event)}
    >
      <Icon name={iconName} className={`h-4 w-4 mr-2 ${isWorking ? "animate-spin" : ""}`} />
      {label}
    </DropdownMenuItem>
  );
}

function OfflineDownloadSheetButton({
  track,
  playlistId,
  onDone,
}: {
  track: OfflineDownloadTrack;
  playlistId?: string;
  onDone: () => void;
}) {
  const { hasAudio, isWorking, isBusy, label, iconName, toggleDownload } = useOfflineTrackDownload(
    track,
    playlistId,
  );
  if (!hasAudio) return null;

  return (
    <Button
      variant="ghost"
      className="w-full justify-start h-12 text-base"
      disabled={isWorking || isBusy}
      onClick={() => {
        void toggleDownload().then(onDone);
      }}
    >
      <Icon name={iconName} className={`h-5 w-5 mr-3 ${isWorking ? "animate-spin" : ""}`} />
      {label}
    </Button>
  );
}

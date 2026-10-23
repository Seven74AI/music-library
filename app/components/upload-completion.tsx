import { useState } from "react";
import { Link, useFetcher } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#app/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert";
import { Button } from "#app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card";
import { Icon } from "#app/components/ui/icon";
import { useToast } from "#app/components/ui/use-toast";
import { formatStorageSaved } from "#app/utils/format-storage-saved";

interface SuccessfulTrack {
  trackId: string;
  fileName: string;
  title: string;
  artist: string;
  /** Bytes not stored again because this upload reused an existing audio file. */
  storageSavedBytes?: number;
  exactDuplicate?: {
    trackId: string;
    title: string;
    artist: string;
    confidence: number;
  };
  fuzzyMatches?: Array<{
    trackId: string;
    title: string;
    artist: string;
    matchScore: number;
    matchType: "fingerprint" | "metadata";
  }>;
}

interface FailedFile {
  fileId: string;
  fileName: string;
  error: string;
}

interface UploadCompletionProps {
  successfulTracks: SuccessfulTrack[];
  failedFiles: FailedFile[];
  onRetryFailed: (failedFiles: FailedFile[]) => void;
  onUploadMore: () => void;
  onViewLibrary: () => void;
}

export function UploadCompletion({
  successfulTracks,
  failedFiles,
  onRetryFailed,
  onUploadMore,
  onViewLibrary,
}: UploadCompletionProps) {
  const hasSuccess = successfulTracks.length > 0;
  const hasFailures = failedFiles.length > 0;

  // Track which tracks have been deleted
  const [deletedTrackIds, setDeletedTrackIds] = useState<Set<string>>(new Set());

  // Track which duplicate warnings have been dismissed
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  // Filter out deleted tracks
  const visibleTracks = successfulTracks.filter((track) => !deletedTrackIds.has(track.trackId));

  // Get tracks with duplicates (not dismissed)
  const tracksWithDuplicates = dismissedWarnings
    ? []
    : visibleTracks.filter((track) => track.exactDuplicate || track.fuzzyMatches?.length);

  const hasBulkDuplicates = tracksWithDuplicates.length >= 2;

  return (
    <div className="space-y-6">
      {/* Bulk Action Banner */}
      {hasBulkDuplicates && (
        <BulkActionBanner
          duplicateCount={tracksWithDuplicates.length}
          tracks={tracksWithDuplicates}
          onDeleteAll={(trackIds) => {
            setDeletedTrackIds((prev) => new Set([...prev, ...trackIds]));
          }}
          onKeepAll={() => {
            setDismissedWarnings(true);
          }}
        />
      )}

      {/* Success Section */}
      {hasSuccess && visibleTracks.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon name="check-circled" className="h-5 w-5 text-green-500" />
              <CardTitle>Upload Successful</CardTitle>
            </div>
            <CardDescription>
              {visibleTracks.length} track{visibleTracks.length !== 1 ? "s" : ""} uploaded
              successfully
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {visibleTracks.map((track) => (
                <TrackItem
                  key={track.trackId}
                  track={track}
                  onDelete={(trackId) => {
                    setDeletedTrackIds((prev) => new Set([...prev, trackId]));
                  }}
                  showDuplicateWarning={!dismissedWarnings}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Section */}
      {hasFailures && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Icon name="question-mark-circled" className="h-5 w-5 text-destructive" />
              <CardTitle>Upload Errors</CardTitle>
            </div>
            <CardDescription>
              {failedFiles.length} file{failedFiles.length !== 1 ? "s" : ""} failed to upload
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {failedFiles.map((file) => (
                <div
                  key={file.fileId}
                  className="p-3 border border-destructive/50 rounded-lg bg-destructive/5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-destructive truncate">{file.fileName}</p>
                      <p className="text-sm text-muted-foreground mt-1">{file.error}</p>
                    </div>
                    <Icon
                      name="question-mark-circled"
                      className="h-5 w-5 text-destructive flex-shrink-0"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Button
                onClick={() => onRetryFailed(failedFiles)}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Icon name="arrow-path" className="mr-2" />
                Retry Failed Uploads
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        {hasSuccess && visibleTracks.length > 0 && (
          <Button onClick={onViewLibrary} className="flex-1">
            <Icon name="arrow-left" className="mr-2" />
            View Library
          </Button>
        )}
        <Button onClick={onUploadMore} variant="outline" className="flex-1">
          <Icon name="plus" className="mr-2" />
          Upload More Files
        </Button>
      </div>
    </div>
  );
}

interface TrackItemProps {
  track: SuccessfulTrack;
  onDelete: (trackId: string) => void;
  showDuplicateWarning: boolean;
}

function TrackItem({ track, onDelete, showDuplicateWarning }: TrackItemProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const fetcher = useFetcher();
  const { toast } = useToast();

  const hasDuplicate = track.exactDuplicate || track.fuzzyMatches?.length;
  const isDuplicate = showDuplicateWarning && hasDuplicate;

  const handleDelete = () => {
    fetcher.submit(null, {
      method: "POST",
      action: `/library/${track.trackId}/remove`,
    });

    // Optimistic update
    onDelete(track.trackId);

    // Show toast based on whether this was a duplicate
    if (hasDuplicate) {
      toast({
        title: "Duplicate Track Deleted",
        description: `"${track.title}" removed. Storage optimized - shared audio file preserved.`,
        variant: "default",
      });
    } else {
      toast({
        title: "Track Deleted",
        description: `"${track.title}" by ${track.artist} has been removed from your library.`,
      });
    }

    setDeleteDialogOpen(false);
  };

  return (
    <>
      <div
        className={`border rounded-lg transition-colors ${
          isDuplicate
            ? "border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20"
            : "hover:bg-muted/50"
        }`}
      >
        {/* Main Track Info */}
        <div className="p-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <Link to={`/library/${track.trackId}`} className="block hover:underline">
              <p className="font-medium truncate">{track.title}</p>
              <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
            </Link>
            <p className="text-xs text-muted-foreground mt-1 truncate">{track.fileName}</p>
          </div>
          <Icon
            name="check-circled"
            className={`h-5 w-5 flex-shrink-0 ${isDuplicate ? "text-amber-600" : "text-green-500"}`}
          />
        </div>

        {/* Duplicate Warning */}
        {isDuplicate && (
          <div className="px-3 pb-3">
            <Alert
              variant="default"
              className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100"
            >
              <Icon name="question-mark-circled" className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900 dark:text-amber-100">
                Similar Audio Detected
              </AlertTitle>
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                {track.exactDuplicate ? (
                  <>
                    This audio is identical to{" "}
                    <Link
                      to={`/library/${track.exactDuplicate.trackId}`}
                      className="font-medium underline"
                    >
                      "{track.exactDuplicate.title}" by {track.exactDuplicate.artist}
                    </Link>{" "}
                    ({track.exactDuplicate.confidence}% match)
                  </>
                ) : track.fuzzyMatches?.[0] ? (
                  <>
                    This audio is similar to{" "}
                    <Link
                      to={`/library/${track.fuzzyMatches[0].trackId}`}
                      className="font-medium underline"
                    >
                      "{track.fuzzyMatches[0].title}" by {track.fuzzyMatches[0].artist}
                    </Link>{" "}
                    ({Math.round(track.fuzzyMatches[0].matchScore * 100)}% match)
                  </>
                ) : null}
              </AlertDescription>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={`/library/${track.exactDuplicate?.trackId || track.fuzzyMatches?.[0]?.trackId}`}
                >
                  <Button variant="outline" size="sm" className="h-8">
                    View Original Track
                  </Button>
                </Link>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Icon name="trash" className="mr-1 h-3 w-3" />
                  Delete This Upload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setShowDetails(!showDetails)}
                >
                  {showDetails ? (
                    <>
                      <Icon name="chevron-up" className="mr-1 h-3 w-3" />
                      Hide Details
                    </>
                  ) : (
                    <>
                      <Icon name="chevron-down" className="mr-1 h-3 w-3" />
                      Show Details
                    </>
                  )}
                </Button>
              </div>

              {/* Expandable Details */}
              {showDetails && (
                <div className="mt-3 pt-3 border-t border-amber-300 dark:border-amber-800 space-y-1 text-sm">
                  {track.exactDuplicate && (
                    <>
                      <div className="flex justify-between">
                        <span className="font-medium">Match Type:</span>
                        <span>Exact content hash</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium">Confidence:</span>
                        <span>{track.exactDuplicate.confidence}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium">Reason:</span>
                        <span>Same audio content</span>
                      </div>
                      {typeof track.storageSavedBytes === "number" && (
                        <div className="flex justify-between">
                          <span className="font-medium">Storage saved:</span>
                          <span>{formatStorageSaved(track.storageSavedBytes)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {track.fuzzyMatches && track.fuzzyMatches.length > 0 && (
                    <>
                      {track.fuzzyMatches.map((match) => (
                        <div
                          key={match.trackId}
                          className="pt-2 border-t border-amber-300/50 dark:border-amber-800/50 first:border-t-0 first:pt-0"
                        >
                          <div className="flex justify-between">
                            <span className="font-medium">Match Type:</span>
                            <span className="capitalize">{match.matchType}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-medium">Match Score:</span>
                            <span>{Math.round(match.matchScore * 100)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-medium">Track:</span>
                            <Link to={`/library/${match.trackId}`} className="underline">
                              {match.title}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </Alert>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Uploaded Track?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "{track.title}" by {track.artist} from your library. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Track
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface BulkActionBannerProps {
  duplicateCount: number;
  tracks: SuccessfulTrack[];
  onDeleteAll: (trackIds: string[]) => void;
  onKeepAll: () => void;
}

function BulkActionBanner({
  duplicateCount,
  tracks,
  onDeleteAll,
  onKeepAll,
}: BulkActionBannerProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const fetcher = useFetcher();
  const { toast } = useToast();

  const handleDeleteAll = async () => {
    const trackIds = tracks.map((t) => t.trackId);

    // One request with repeated trackIds (decision #24). A single useFetcher
    // instance tracks only one in-flight submission — firing N synchronous
    // submits would supersede earlier ones and drop all but the last delete.
    const formData = new FormData();
    formData.append("action", "remove");
    for (const trackId of trackIds) {
      formData.append("trackIds", trackId);
    }
    fetcher.submit(formData, {
      method: "POST",
      action: "/resources/track-library",
    });

    // Optimistic update
    onDeleteAll(trackIds);

    toast({
      title: "Duplicates Deleted",
      description: `${duplicateCount} duplicate track${duplicateCount !== 1 ? "s" : ""} removed from your library.`,
    });

    setDeleteDialogOpen(false);
  };

  return (
    <>
      <Alert variant="default" className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
        <Icon name="question-mark-circled" className="h-5 w-5 text-amber-600" />
        <AlertTitle className="text-amber-900 dark:text-amber-100">
          {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} detected
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-200">
          These tracks appear to match files already in your library.
        </AlertDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
            <Icon name="trash" className="mr-2 h-4 w-4" />
            Delete All Duplicates
          </Button>
          <Button variant="outline" size="sm" onClick={onKeepAll}>
            Keep All
          </Button>
        </div>
      </Alert>

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {duplicateCount} Duplicate Tracks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {duplicateCount} duplicate track{duplicateCount !== 1 ? "s" : ""}{" "}
              from your library. This action cannot be undone.
              <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
                {tracks.slice(0, 5).map((track) => (
                  <div key={track.trackId} className="text-sm">
                    • {track.title} by {track.artist}
                  </div>
                ))}
                {tracks.length > 5 && (
                  <div className="text-sm text-muted-foreground">
                    ...and {tracks.length - 5} more
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {duplicateCount} Track{duplicateCount !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

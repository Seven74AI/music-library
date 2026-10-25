import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import { Icon } from "#app/components/ui/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#app/components/ui/tabs";
import { formatDuration } from "#app/utils/format-duration";
import { formatServiceDateAdded } from "#app/utils/service-date.ts";
import { BasicMetadataTab } from "./track-details-dialog/basic-metadata-tab";
import { ExtendedMetadataTab } from "./track-details-dialog/extended-metadata-tab";
import { HistoryTab } from "./track-details-dialog/history-tab";
import { CommentDialog } from "./track-details-dialog/comment-dialog";
import { CuratorNotes } from "./curator-notes";
import { LockBanner } from "./lock-banner";
import { useLock } from "#app/hooks/use-lock";
import { broadcastCuratorMessage, useCuratorSync } from "#app/features/curator/sync.client";
import {
  clearSessionState,
  saveSessionState,
  SESSION_SAVE_DEBOUNCE_MS,
} from "#app/features/curator/session-recovery.client.ts";
import { type TrackMetadataChanges } from "#app/types/track-metadata";
import { UndoToast } from "./undo-toast";

export interface TrackDetails {
  id: string;
  title: string;
  artist: { id: string; name: string };
  albumRecord: { id: string; name: string } | null;
  duration: number | null;
  createdAt: string | Date;
  releaseDate: string | Date | null;
  originalDate: string | Date | null;
  coverImage: { objectKey: string } | null;
  service: { displayName: string } | null;
  serviceUrl: string | null;
  // Additional metadata
  genre: string | null; // Keep for backward compatibility
  genres: Array<{ id: string; name: string }>;
  year: number | null;
  trackNumber: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
  isrc: string | null;
  originalYear: number | null;
  totalTracks: number | null;
  totalDiscs: number | null;
  lyrics: string | null;
}

interface TrackDetailsDialogProps {
  trackId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "basic" | "extended" | "history" | "notes";
  initialDraft?: Record<string, unknown> | null;
}

type MetadataWriteResult = {
  edit?: { id?: string };
  error?: string;
};

function isSuccessfulMetadataWrite(data: unknown): data is { edit: { id: string } } {
  if (!data || typeof data !== "object") return false;
  if ("error" in data && (data as MetadataWriteResult).error) return false;
  const edit = (data as MetadataWriteResult).edit;
  return !!edit && typeof edit.id === "string" && edit.id.length > 0;
}

export function TrackDetailsDialog({
  trackId,
  open,
  onOpenChange,
  initialTab = "basic",
  initialDraft = null,
}: TrackDetailsDialogProps) {
  const detailsFetcher = useFetcher<{
    track: TrackDetails;
    isCurator: boolean;
    notesCount: number;
    currentUserId: string;
  }>();
  const editFetcher = useFetcher<MetadataWriteResult>();
  const restoreFetcher = useFetcher<MetadataWriteResult>();
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<TrackMetadataChanges | null>(null);
  const [fieldDraft, setFieldDraft] = useState<Record<string, unknown> | null>(initialDraft);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const handledEdit = useRef<unknown>(null);
  const handledRestore = useRef<unknown>(null);
  const requestedTrackId = useRef<string | null>(null);
  const seenTrackId = useRef(trackId);

  const loadedTrack = detailsFetcher.data?.track;
  const track = loadedTrack?.id === trackId ? loadedTrack : undefined;
  const isCurator = track ? (detailsFetcher.data?.isCurator ?? false) : false;
  const isStale = loadedTrack != null && loadedTrack.id !== trackId;
  const isLoading =
    !track && (detailsFetcher.state !== "idle" || detailsFetcher.data == null || isStale);

  // Lock integration - only acquire if curator
  const {
    lock,
    isLockedByOther,
    refresh: refreshLock,
  } = useLock("track", trackId, {
    autoAcquire: open && isCurator,
    autoRelease: true,
  });

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab, trackId]);

  useEffect(() => {
    if (seenTrackId.current === trackId) return;
    seenTrackId.current = trackId;
    setPendingChanges(null);
    setShowCommentDialog(false);
    setShowUndoToast(false);
    setFieldDraft(null);
  }, [trackId]);

  useEffect(() => {
    if (!open) {
      requestedTrackId.current = null;
      return;
    }
    if (detailsFetcher.state !== "idle") return;
    if (loadedTrack?.id === trackId) {
      requestedTrackId.current = null;
      return;
    }
    // A failed load leaves the previous payload in place. Don't retry it forever.
    if (requestedTrackId.current === trackId) return;
    requestedTrackId.current = trackId;
    detailsFetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
  }, [open, trackId, detailsFetcher, loadedTrack?.id]);

  useEffect(() => {
    if (detailsFetcher.state === "idle" && detailsFetcher.data) {
      setShowCommentDialog(false);
      setPendingChanges(null);
    }
  }, [detailsFetcher.state, detailsFetcher.data]);

  useEffect(() => {
    if (editFetcher.state !== "idle" || !editFetcher.data) return;
    if (handledEdit.current === editFetcher.data) return;
    if (!isSuccessfulMetadataWrite(editFetcher.data)) return;
    handledEdit.current = editFetcher.data;

    broadcastCuratorMessage({
      type: "ENTITY_UPDATED",
      entityType: "track",
      entityId: trackId,
    });
    setShowUndoToast(true);
    detailsFetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
  }, [editFetcher.state, editFetcher.data, trackId, detailsFetcher]);

  useEffect(() => {
    if (restoreFetcher.state !== "idle" || !restoreFetcher.data) return;
    if (handledRestore.current === restoreFetcher.data) return;
    if (!isSuccessfulMetadataWrite(restoreFetcher.data)) return;
    handledRestore.current = restoreFetcher.data;

    broadcastCuratorMessage({
      type: "ENTITY_UPDATED",
      entityType: "track",
      entityId: trackId,
    });
    detailsFetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
  }, [restoreFetcher.state, restoreFetcher.data, trackId, detailsFetcher]);

  // BroadcastChannel integration
  useEffect(() => {
    if (!open) return;

    const cleanup = useCuratorSync((message) => {
      if (
        message.type === "LOCK_RELEASED" &&
        message.entityType === "track" &&
        message.entityId === trackId
      ) {
        // Lock was released by another curator, refresh lock status
        refreshLock();
      } else if (
        message.type === "ENTITY_UPDATED" &&
        message.entityType === "track" &&
        message.entityId === trackId
      ) {
        // Track was updated by another curator, reload track details
        detailsFetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
      }
    });

    return cleanup;
  }, [open, trackId, refreshLock, detailsFetcher]);

  useEffect(() => {
    if (typeof saveSessionState !== "function") return;
    if (!open) {
      clearSessionState?.("dialogs");
      return;
    }
    const unsavedChanges = pendingChanges ?? fieldDraft ?? undefined;
    const timer = window.setTimeout(() => {
      saveSessionState({
        type: "dialogs",
        openDialogs: [
          {
            dialogType: "track-edit",
            entityId: trackId,
            tab: activeTab,
            unsavedChanges:
              unsavedChanges && Object.keys(unsavedChanges).length > 0 ? unsavedChanges : undefined,
          },
        ],
        timestamp: Date.now(),
      });
    }, SESSION_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, trackId, activeTab, pendingChanges, fieldDraft]);

  const serviceDateAdded = track
    ? formatServiceDateAdded({
        releaseDate: track.releaseDate,
        originalDate: track.originalDate,
        createdAt: track.createdAt,
      })
    : null;

  const handleSaveChanges = (changes: TrackMetadataChanges) => {
    setPendingChanges(changes);
    setShowCommentDialog(true);
  };

  const handleSubmitWithComment = (comment: string | null) => {
    if (!pendingChanges) return;

    const payload = comment == null ? pendingChanges : { ...pendingChanges, comment };

    editFetcher.submit(payload, {
      method: "POST",
      action: `/api/metadata/tracks/${trackId}/edit`,
      encType: "application/json",
    });

    setShowCommentDialog(false);
    setPendingChanges(null);
  };

  const handleRestore = (editId: string, comment: string | null) => {
    if (!comment) return;

    restoreFetcher.submit(
      { comment },
      {
        method: "POST",
        action: `/api/metadata/tracks/${trackId}/restore/${editId}`,
        encType: "application/json",
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          overlayClassName="z-[80]"
          overlayTestId="track-details-overlay"
          className="z-[80] max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto"
        >
          {isLoading || isStale ? (
            <>
              <div className="flex items-center justify-center py-12">
                <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
              <DialogDescription className="sr-only">Loading track details...</DialogDescription>
            </>
          ) : !track ? (
            <>
              <div className="py-8 text-center text-sm text-muted-foreground">
                Unable to load track details
              </div>
              <DialogDescription className="sr-only">
                Failed to load track details
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-left">
                  <div className="flex items-center gap-3">
                    <TrackThumbnail coverImage={track.coverImage} alt={track.title} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={track.title}>
                        {track.title}
                      </div>
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={track.artist.name}
                      >
                        {track.artist.name}
                      </div>
                      {isCurator && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          <Icon name="pencil-1" className="h-3 w-3" />
                          Curator
                        </div>
                      )}
                    </div>
                  </div>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Track details for {track.title} by {track.artist.name}
                </DialogDescription>
              </DialogHeader>

              {/* Lock Banner */}
              {isCurator && isLockedByOther && lock && (
                <LockBanner
                  lockedByName={lock.lockedByName}
                  entityType="track"
                  onRefresh={refreshLock}
                />
              )}

              {isCurator ? (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="basic">Basic</TabsTrigger>
                    <TabsTrigger value="extended">Extended</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                    <TabsTrigger value="notes">
                      Notes
                      {detailsFetcher.data?.notesCount ? (
                        <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-xs">
                          {detailsFetcher.data.notesCount}
                        </span>
                      ) : null}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="basic" className="mt-4">
                    <BasicMetadataTab
                      key={track.id}
                      track={track}
                      onSave={handleSaveChanges}
                      disabled={isLockedByOther}
                      initialDraft={initialDraft}
                      onDraftChange={setFieldDraft}
                    />
                  </TabsContent>

                  <TabsContent value="extended" className="mt-4">
                    <ExtendedMetadataTab
                      key={track.id}
                      track={track}
                      onSave={handleSaveChanges}
                      disabled={isLockedByOther}
                    />
                  </TabsContent>

                  <TabsContent value="history" className="mt-4">
                    <HistoryTab key={trackId} trackId={trackId} onRestore={handleRestore} />
                  </TabsContent>

                  <TabsContent value="notes" className="mt-4">
                    {detailsFetcher.data?.currentUserId && (
                      <CuratorNotes
                        key={trackId}
                        entityType="track"
                        entityId={trackId}
                        currentUserId={detailsFetcher.data.currentUserId}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Track Information</div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div>Artist: {track.artist.name}</div>
                      {track.albumRecord && <div>Album: {track.albumRecord.name}</div>}
                      {track.genres.length > 0 && (
                        <div>Genres: {track.genres.map((g) => g.name).join(", ")}</div>
                      )}
                      {track.year && <div>Year: {track.year}</div>}
                      <div>Duration: {formatDuration(track.duration)}</div>
                      <div>Added: {new Date(track.createdAt).toLocaleDateString()}</div>
                      {track.service?.displayName && <div>Source: {track.service.displayName}</div>}
                      {serviceDateAdded && <div>Date added: {serviceDateAdded}</div>}
                    </div>
                  </div>
                  {track.serviceUrl && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          window.open(track.serviceUrl!, "_blank", "noopener,noreferrer")
                        }
                        className="flex-1"
                      >
                        <Icon name="link-2" className="mr-2 h-4 w-4" />
                        Open on YouTube
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {showCommentDialog && track ? (
        <CommentDialog
          open={showCommentDialog}
          onOpenChange={setShowCommentDialog}
          onSubmit={handleSubmitWithComment}
          title="Edit Comment"
          description="Optionally add a comment explaining why you're making this change."
          required={false}
        />
      ) : null}

      {showUndoToast && (
        <UndoToast
          open={showUndoToast}
          onOpenChange={setShowUndoToast}
          trackId={trackId}
          onUndo={() => {
            // Reload track details after undo
            detailsFetcher.load(`/resources/track-details?trackId=${encodeURIComponent(trackId)}`);
          }}
        />
      )}
    </>
  );
}

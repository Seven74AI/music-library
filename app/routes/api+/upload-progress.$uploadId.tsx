// @context7: React Router, Server-Sent Events, Streaming
import { data, type LoaderFunctionArgs } from "react-router";
import { requireUserWithRole } from "#app/utils/permissions.server";

// Type for file data stored for retry capability
export interface StoredFileData {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
  metadata: {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    year?: number;
    trackNumber?: number;
    albumArtist?: string;
    bpm?: number;
    label?: string;
    isrc?: string;
    originalDate?: string;
    originalYear?: number;
    releaseDate?: string;
    totalTracks?: number;
    totalDiscs?: number;
    lyrics?: string;
    [key: string]: unknown;
  };
  userMetadata?: {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
    year?: number;
    trackNumber?: number;
    albumArtist?: string;
    bpm?: number;
    label?: string;
    isrc?: string;
    originalDate?: string;
    originalYear?: number;
    releaseDate?: string;
    totalTracks?: number;
    totalDiscs?: number;
    lyrics?: string;
  };
}

export interface SuccessfulTrackInfo {
  trackId: string;
  fileName: string;
  title: string;
  artist: string;
  /** Bytes not uploaded again because this file reused an existing object. */
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

/** Progress payload sent to the upload completion screen. Undefined sizes are omitted. */
export function serializeSuccessfulTrack(track: SuccessfulTrackInfo) {
  return {
    trackId: track.trackId,
    fileName: track.fileName,
    title: track.title,
    artist: track.artist,
    storageSavedBytes: track.storageSavedBytes,
    exactDuplicate: track.exactDuplicate,
    fuzzyMatches: track.fuzzyMatches,
  };
}

export interface UploadProgressEntry {
  files: Array<{
    fileId: string;
    fileName: string;
    progress: number;
    status: "pending" | "processing" | "uploading" | "completed" | "failed";
    error?: string;
    fileSize?: number; // File size in bytes for speed calculation
  }>;
  overallProgress: number;
  status: "active" | "completed" | "failed";
  startTime?: number; // Timestamp when upload started
  /** Timestamp of the last mutation. The TTL sweeper reclaims sessions with no activity past this. */
  lastUpdated: number;
  successfulTracks?: SuccessfulTrackInfo[];
  failedFiles?: Array<{
    fileId: string;
    fileName: string;
    error: string;
    fileData?: StoredFileData;
  }>;
}

// In-memory store for upload progress. Bounded by the TTL sweeper
// (startUploadProgressSweeper) so abandoned sessions that hold full audio
// buffers cannot accumulate without limit. For multi-instance deployments
// replace with a shared store (Redis) — see ADR-010 "Progress Store".
const uploadProgressStore = new Map<string, UploadProgressEntry>();

// Store active SSE connections for real-time updates
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>();

/**
 * Get upload progress for a session
 */
export function getUploadProgress(uploadId: string) {
  return uploadProgressStore.get(uploadId);
}

/**
 * Set upload progress for a session
 */
export function setUploadProgress(
  uploadId: string,
  progress: Omit<UploadProgressEntry, "lastUpdated">,
) {
  uploadProgressStore.set(uploadId, { ...progress, lastUpdated: Date.now() });
}

/**
 * Initialize upload progress for a session
 */
export function initUploadProgress(uploadId: string, fileNames: string[]) {
  const files = fileNames.map((fileName, index) => ({
    fileId: `file-${index}`,
    fileName,
    progress: 0,
    status: "pending" as const,
  }));

  setUploadProgress(uploadId, {
    files,
    overallProgress: 0,
    status: "active",
    startTime: Date.now(),
    successfulTracks: [],
    failedFiles: [],
  });
}

/**
 * Push progress update to all active SSE connections for this upload
 */
function pushProgressUpdate(uploadId: string) {
  const progress = getUploadProgress(uploadId);
  if (!progress) return;

  const connections = activeConnections.get(uploadId);
  if (!connections || connections.size === 0) return;

  // Calculate upload speed
  let uploadSpeed = 0;
  if (progress.startTime) {
    const elapsedSeconds = (Date.now() - progress.startTime) / 1000;
    if (elapsedSeconds > 0) {
      // Calculate total bytes transferred
      const totalBytes = progress.files.reduce((sum, file) => {
        if (file.fileSize && file.status !== "pending" && file.status !== "processing") {
          // Only count bytes for files that are uploading or completed
          return sum + (file.fileSize * file.progress) / 100;
        }
        return sum;
      }, 0);
      uploadSpeed = totalBytes / elapsedSeconds; // bytes per second
    }
  }

  // Create a clean progress object for JSON serialization
  // Avoid circular references and ensure all data is serializable
  const cleanProgress = {
    type: "progress" as const,
    files: progress.files.map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      progress: file.progress,
      status: file.status,
      error: file.error,
    })),
    overallProgress: progress.overallProgress,
    status: progress.status,
    uploadSpeed,
    successfulTracks: (progress.successfulTracks || []).map(serializeSuccessfulTrack),
    failedFiles: (progress.failedFiles || []).map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      error: file.error,
    })),
  };

  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(`data: ${JSON.stringify(cleanProgress)}\n\n`);

    // Send to all active connections
    for (const controller of connections) {
      try {
        controller.enqueue(message);
      } catch {
        // Connection might be closed, remove it
        connections.delete(controller);
      }
    }
  } catch (error) {
    // If JSON.stringify fails, log error but don't crash
    console.error("Error serializing progress update:", error);
  }
}

/**
 * Update progress for a specific file
 */
export function updateFileProgress(
  uploadId: string,
  fileId: string,
  progress: number,
  status?: "processing" | "uploading" | "completed" | "failed",
  error?: string,
  fileSize?: number, // Optional file size in bytes for speed calculation
) {
  const current = uploadProgressStore.get(uploadId);
  if (!current) return;

  const fileIndex = current.files.findIndex((f) => f.fileId === fileId);
  if (fileIndex === -1) return;

  const file = current.files[fileIndex];
  if (!file) return;

  if (status) {
    file.status = status;
  }
  file.progress = progress;
  if (error) {
    file.error = error;
  }
  if (fileSize !== undefined) {
    file.fileSize = fileSize;
  }

  // Calculate overall progress
  const totalProgress = current.files.reduce((sum, fileEntry) => sum + fileEntry.progress, 0);
  current.overallProgress = Math.round(totalProgress / current.files.length);

  // Update status if all files are completed or failed
  const allCompleted = current.files.every(
    (f) => f.status === "completed" || f.status === "failed",
  );
  if (allCompleted) {
    const hasFailures = current.files.some((f) => f.status === "failed");
    current.status = hasFailures ? "failed" : "completed";
  }

  current.lastUpdated = Date.now();
  uploadProgressStore.set(uploadId, current);

  // Push update immediately to all active connections
  pushProgressUpdate(uploadId);
}

/**
 * Add successful track to progress store
 */
export function addSuccessfulTrack(uploadId: string, trackInfo: SuccessfulTrackInfo) {
  const current = uploadProgressStore.get(uploadId);
  if (!current) return;

  if (!current.successfulTracks) {
    current.successfulTracks = [];
  }
  current.successfulTracks.push(trackInfo);
  current.lastUpdated = Date.now();
  uploadProgressStore.set(uploadId, current);
}

/**
 * Add failed file to progress store with file data for retry
 */
export function addFailedFile(
  uploadId: string,
  fileId: string,
  error: string,
  fileData?: StoredFileData,
) {
  const current = uploadProgressStore.get(uploadId);
  if (!current) return;

  const file = current.files.find((f) => f.fileId === fileId);
  if (!file) return;

  if (!current.failedFiles) {
    current.failedFiles = [];
  }
  current.failedFiles.push({
    fileId,
    fileName: file.fileName,
    error,
    fileData,
  });
  current.lastUpdated = Date.now();
  uploadProgressStore.set(uploadId, current);
}

/** Entries with no activity past this are reclaimed by the sweeper. */
export const UPLOAD_PROGRESS_TTL_MS = 60 * 60 * 1000; // 1 hour
/** How often the in-process sweeper runs. */
export const UPLOAD_PROGRESS_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
/** Hard cap on tracked sessions; least-recently-updated are evicted first. */
export const MAX_UPLOAD_PROGRESS_ENTRIES = 100;

let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Reclaim abandoned upload-progress sessions so their in-memory audio buffers
 * cannot accumulate without bound. Runs on an interval via
 * {@link startUploadProgressSweeper}; also safe to call directly.
 * Returns the number of sessions remaining after the sweep.
 */
export function cleanupOldProgress(options?: { now?: number; ttlMs?: number }): number {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? UPLOAD_PROGRESS_TTL_MS;

  // TTL sweep: drop sessions with no activity within the TTL window.
  for (const [uploadId, entry] of uploadProgressStore) {
    if (now - entry.lastUpdated > ttlMs) {
      uploadProgressStore.delete(uploadId);
      activeConnections.delete(uploadId);
    }
  }

  // Hard cap: evict the least-recently-updated sessions first.
  const excess = uploadProgressStore.size - MAX_UPLOAD_PROGRESS_ENTRIES;
  if (excess > 0) {
    const oldest = [...uploadProgressStore.entries()]
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated)
      .slice(0, excess);
    for (const [uploadId] of oldest) {
      uploadProgressStore.delete(uploadId);
      activeConnections.delete(uploadId);
    }
  }

  return uploadProgressStore.size;
}

/**
 * Start the in-process TTL sweeper for upload progress. Idempotent: a second
 * call does not register another interval. Each instance only sweeps its own
 * in-memory Map.
 */
export function startUploadProgressSweeper(): void {
  if (cleanupIntervalHandle !== null) return;

  cleanupIntervalHandle = setInterval(() => {
    cleanupOldProgress();
  }, UPLOAD_PROGRESS_CLEANUP_INTERVAL_MS);
}

/** Stop the sweeper (used by tests and shutdown paths). */
export function stopUploadProgressSweeper(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }
}

/** Reset the in-memory store between tests. */
export function resetUploadProgressStoreForTests(): void {
  uploadProgressStore.clear();
  activeConnections.clear();
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireUserWithRole(request, "admin");

  const uploadId = params.uploadId;
  if (!uploadId) {
    return data({ error: "Upload ID is required" }, { status: 400 });
  }

  // Create SSE stream with real-time updates
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Register this connection for real-time updates
      if (!activeConnections.has(uploadId)) {
        activeConnections.set(uploadId, new Set());
      }
      activeConnections.get(uploadId)?.add(controller);

      // Send initial progress state
      const initialProgress = getUploadProgress(uploadId);
      if (initialProgress) {
        // Calculate initial upload speed
        let uploadSpeed = 0;
        if (initialProgress.startTime) {
          const elapsedSeconds = (Date.now() - initialProgress.startTime) / 1000;
          if (elapsedSeconds > 0) {
            const totalBytes = initialProgress.files.reduce((sum, file) => {
              if (file.fileSize && file.status !== "pending" && file.status !== "processing") {
                return sum + (file.fileSize * file.progress) / 100;
              }
              return sum;
            }, 0);
            uploadSpeed = totalBytes / elapsedSeconds;
          }
        }
        // Create clean progress object to avoid JSON.stringify issues
        const cleanInitialProgress = {
          type: "progress" as const,
          files: initialProgress.files.map((file) => ({
            fileId: file.fileId,
            fileName: file.fileName,
            progress: file.progress,
            status: file.status,
            error: file.error,
          })),
          overallProgress: initialProgress.overallProgress,
          status: initialProgress.status,
          uploadSpeed,
          successfulTracks: (initialProgress.successfulTracks || []).map(serializeSuccessfulTrack),
          failedFiles: (initialProgress.failedFiles || []).map((file) => ({
            fileId: file.fileId,
            fileName: file.fileName,
            error: file.error,
          })),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(cleanInitialProgress)}\n\n`));
      }

      // Periodic heartbeat to check if upload is completed (fallback for edge cases)
      const heartbeat = setInterval(() => {
        const progress = getUploadProgress(uploadId);

        if (!progress) {
          controller.enqueue(
            encoder.encode('data: {"type":"error","message":"Upload session not found"}\n\n'),
          );
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // Close stream if upload is completed or failed
        if (progress.status === "completed" || progress.status === "failed") {
          clearInterval(heartbeat);
          // Send final update
          let uploadSpeed = 0;
          if (progress.startTime) {
            const elapsedSeconds = (Date.now() - progress.startTime) / 1000;
            if (elapsedSeconds > 0) {
              const totalBytes = progress.files.reduce((sum, file) => {
                if (file.fileSize) {
                  return sum + (file.fileSize * file.progress) / 100;
                }
                return sum;
              }, 0);
              uploadSpeed = totalBytes / elapsedSeconds;
            }
          }
          // Create clean progress object
          const cleanFinalProgress = {
            type: "progress" as const,
            files: progress.files.map((file) => ({
              fileId: file.fileId,
              fileName: file.fileName,
              progress: file.progress,
              status: file.status,
              error: file.error,
            })),
            overallProgress: progress.overallProgress,
            status: progress.status,
            uploadSpeed,
            successfulTracks: (progress.successfulTracks || []).map(serializeSuccessfulTrack),
            failedFiles: (progress.failedFiles || []).map((file) => ({
              fileId: file.fileId,
              fileName: file.fileName,
              error: file.error,
            })),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(cleanFinalProgress)}\n\n`));
          // Keep data for a bit longer to allow client to fetch it
          setTimeout(() => {
            uploadProgressStore.delete(uploadId);
            activeConnections.delete(uploadId);
          }, 30000); // Keep for 30 seconds to allow completion screen to load
          controller.close();
        }
      }, 1000); // Check every 1 second (just for completion detection)

      // Cleanup on client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        activeConnections.get(uploadId)?.delete(controller);
        if (activeConnections.get(uploadId)?.size === 0) {
          activeConnections.delete(uploadId);
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

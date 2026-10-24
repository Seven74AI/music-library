import { data, type LoaderFunctionArgs } from "react-router";
import { requireUserWithRole } from "#app/utils/permissions.server";
import {
  deleteUploadProgress,
  getUploadProgress,
  serializeSuccessfulTrack,
  subscribeToProgressUpdates,
  type UploadProgressEntry,
} from "#app/features/upload-progress/progress-store.server";

// Active SSE connections are instance-local. On a multi-instance deployment the
// async upload and this SSE poll can land on different instances, so these
// connections only receive the immediate (same-instance) push; the 1s heartbeat
// below polls the shared store and covers cross-instance visibility.
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>();

/** Build the clean, JSON-serializable progress payload sent to SSE clients. */
function buildProgressPayload(progress: UploadProgressEntry) {
  let uploadSpeed = 0;
  if (progress.startTime) {
    const elapsedSeconds = (Date.now() - progress.startTime) / 1000;
    if (elapsedSeconds > 0) {
      const totalBytes = progress.files.reduce((sum, file) => {
        if (file.fileSize && file.status !== "pending" && file.status !== "processing") {
          return sum + (file.fileSize * file.progress) / 100;
        }
        return sum;
      }, 0);
      uploadSpeed = totalBytes / elapsedSeconds;
    }
  }

  return {
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
}

function enqueue(controller: ReadableStreamDefaultController, payload: unknown) {
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  } catch (error) {
    console.error("Error serializing progress update:", error);
  }
}

/** Push the latest progress to every active SSE connection for this upload. */
async function pushProgressUpdate(uploadId: string) {
  const progress = await getUploadProgress(uploadId);
  if (!progress) return;

  const connections = activeConnections.get(uploadId);
  if (!connections || connections.size === 0) return;

  const payload = buildProgressPayload(progress);
  for (const controller of connections) {
    try {
      enqueue(controller, payload);
    } catch {
      // Connection might be closed, remove it.
      connections.delete(controller);
    }
  }
}

// Forward instance-local mutations to the SSE push immediately.
subscribeToProgressUpdates((uploadId) => {
  void pushProgressUpdate(uploadId);
});

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireUserWithRole(request, "admin");

  const uploadId = params.uploadId;
  if (!uploadId) {
    return data({ error: "Upload ID is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  // Create SSE stream with real-time updates.
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message.
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Register this connection for real-time updates.
      if (!activeConnections.has(uploadId)) {
        activeConnections.set(uploadId, new Set());
      }
      activeConnections.get(uploadId)?.add(controller);

      // Send initial progress state.
      void getUploadProgress(uploadId).then((initialProgress) => {
        if (initialProgress) {
          enqueue(controller, buildProgressPayload(initialProgress));
        }
      });

      // Periodic heartbeat: poll the shared store so progress stays visible
      // across instances (where the immediate push is instance-local), and
      // detect completion as a fallback for missed pushes.
      const heartbeat = setInterval(() => {
        void (async () => {
          const progress = await getUploadProgress(uploadId);

          if (!progress) {
            enqueue(controller, { type: "error", message: "Upload session not found" });
            clearInterval(heartbeat);
            controller.close();
            return;
          }

          enqueue(controller, buildProgressPayload(progress));

          // Close the stream once the upload is completed or failed.
          if (progress.status === "completed" || progress.status === "failed") {
            clearInterval(heartbeat);
            // Keep data for a bit longer to allow the client to fetch it.
            setTimeout(() => {
              void deleteUploadProgress(uploadId);
              activeConnections.delete(uploadId);
            }, 30_000);
            controller.close();
          }
        })();
      }, 1000);

      // Cleanup on client disconnect.
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

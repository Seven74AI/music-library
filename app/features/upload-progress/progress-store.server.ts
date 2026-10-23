import { Redis } from "@upstash/redis";

/**
 * Shared upload-progress store.
 *
 * The progress state is small JSON metadata (file list, percentages, status,
 * successful/failed summaries). It MUST NOT hold audio buffers — retry buffers
 * were dropped in favour of client-side re-upload (the completion screen's
 * "Retry" re-sends the failed files from the browser), so the shared store
 * stays Redis-safe. See ADR-038 "Upload Progress Store".
 *
 * Backend selection: when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * are both set, progress lives in Redis (Upstash) so the async upload and the
 * SSE poll can agree across instances. Otherwise it falls back to an in-memory
 * Map, bounded by a TTL sweeper + max-entry cap (single-instance / tests).
 */

/** Track info reported to the upload-completion screen. */
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

export interface UploadProgressFile {
  fileId: string;
  fileName: string;
  progress: number;
  status: "pending" | "processing" | "uploading" | "completed" | "failed";
  error?: string;
  /** File size in bytes for upload-speed calculation. */
  fileSize?: number;
}

export interface FailedFileInfo {
  fileId: string;
  fileName: string;
  error: string;
}

export interface UploadProgressEntry {
  files: UploadProgressFile[];
  overallProgress: number;
  status: "active" | "completed" | "failed";
  /** Timestamp the upload started. */
  startTime?: number;
  /** Timestamp of the last mutation — the TTL sweeper reclaims idle sessions. */
  lastUpdated: number;
  successfulTracks?: SuccessfulTrackInfo[];
  failedFiles?: FailedFileInfo[];
}

/** Sessions idle past this are reclaimed (memory sweeper / Redis EXPIRE). */
export const UPLOAD_PROGRESS_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Redis EXPIRE duration for a progress key. */
export const UPLOAD_PROGRESS_TTL_SECONDS = 60 * 60;
/** How often the in-memory sweeper runs (memory backend only). */
export const UPLOAD_PROGRESS_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
/** Hard cap on tracked sessions; least-recently-updated are evicted first. */
export const MAX_UPLOAD_PROGRESS_ENTRIES = 100;

/** Low-level backend contract shared by the memory and Redis implementations. */
interface ProgressBackend {
  get(uploadId: string): Promise<UploadProgressEntry | undefined>;
  set(uploadId: string, entry: UploadProgressEntry): Promise<void>;
  delete(uploadId: string): Promise<void>;
  /** Reclaim TTL-expired + over-cap sessions. Returns the remaining count. */
  sweep(options?: { now?: number; ttlMs?: number }): Promise<number>;
  /** Whether this backend needs the in-process sweeper interval. */
  needsSweeper(): boolean;
  /** Reset state between tests (memory backend only). */
  resetForTests?(): void;
}

/** In-memory Map backend. Bounded by the TTL sweeper + max-entry cap. */
class MemoryProgressBackend implements ProgressBackend {
  private readonly store = new Map<string, UploadProgressEntry>();

  async get(uploadId: string): Promise<UploadProgressEntry | undefined> {
    return this.store.get(uploadId);
  }

  async set(uploadId: string, entry: UploadProgressEntry): Promise<void> {
    this.store.set(uploadId, entry);
  }

  async delete(uploadId: string): Promise<void> {
    this.store.delete(uploadId);
  }

  async sweep(options?: { now?: number; ttlMs?: number }): Promise<number> {
    const now = options?.now ?? Date.now();
    const ttlMs = options?.ttlMs ?? UPLOAD_PROGRESS_TTL_MS;

    // TTL sweep: drop sessions with no activity within the TTL window.
    for (const [uploadId, entry] of this.store) {
      if (now - entry.lastUpdated > ttlMs) {
        this.store.delete(uploadId);
      }
    }

    // Hard cap: evict the least-recently-updated sessions first.
    const excess = this.store.size - MAX_UPLOAD_PROGRESS_ENTRIES;
    if (excess > 0) {
      const oldest = [...this.store.entries()]
        .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated)
        .slice(0, excess);
      for (const [uploadId] of oldest) {
        this.store.delete(uploadId);
      }
    }

    return this.store.size;
  }

  needsSweeper(): boolean {
    return true;
  }

  resetForTests(): void {
    this.store.clear();
  }
}

/**
 * Redis (Upstash) backend. Each session is a JSON string under
 * `upload-progress:{uploadId}` with an EXPIRE (refreshed on every write), so
 * idle sessions disappear without any in-process sweeper. A sorted-set LRU
 * index (`upload-progress:lru`) enforces the max-entry cap on each write.
 */
class RedisProgressBackend implements ProgressBackend {
  private readonly lruKey = "upload-progress:lru";

  constructor(private readonly redis: Redis) {}

  private keyFor(uploadId: string): string {
    return `upload-progress:${uploadId}`;
  }

  async get(uploadId: string): Promise<UploadProgressEntry | undefined> {
    const raw = await this.redis.get(this.keyFor(uploadId));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw as string) as UploadProgressEntry;
    } catch {
      return undefined;
    }
  }

  async set(uploadId: string, entry: UploadProgressEntry): Promise<void> {
    const key = this.keyFor(uploadId);
    // EX refreshes the TTL on every write → idle sessions expire after 1h.
    await this.redis.set(key, JSON.stringify(entry), {
      ex: UPLOAD_PROGRESS_TTL_SECONDS,
    });
    await this.redis.zadd(this.lruKey, {
      score: entry.lastUpdated,
      member: uploadId,
    });
    await this.enforceCap();
  }

  async delete(uploadId: string): Promise<void> {
    await this.redis.del(this.keyFor(uploadId));
    await this.redis.zrem(this.lruKey, uploadId);
  }

  async sweep(): Promise<number> {
    // Redis EXPIRE handles TTL natively; the LRU cap runs on every write.
    return 0;
  }

  needsSweeper(): boolean {
    return false;
  }

  private async enforceCap(): Promise<void> {
    const count = await this.redis.zcard(this.lruKey);
    const excess = count - MAX_UPLOAD_PROGRESS_ENTRIES;
    if (excess <= 0) return;

    const oldest = (await this.redis.zrange(this.lruKey, 0, excess - 1)) as string[];
    if (oldest.length === 0) return;

    await this.redis.zrem(this.lruKey, ...oldest);
    await this.redis.del(...oldest.map((id) => this.keyFor(id)));
  }
}

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL ?? "",
      token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      // Keep values as raw strings so we control JSON (de)serialization.
      automaticDeserialization: false,
    });
  }
  return redisClient;
}

function createBackend(): ProgressBackend {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new RedisProgressBackend(getRedisClient());
  }
  return new MemoryProgressBackend();
}

const backend: ProgressBackend = createBackend();

/**
 * Per-uploadId async mutex. File processors for a single upload run in
 * parallel (MAX_CONCURRENCY), so read-modify-write mutations must be
 * serialized per session to avoid lost updates — especially across the async
 * Redis round-trip, which the synchronous in-memory Map previously hid.
 */
const updateLocks = new Map<string, Promise<unknown>>();

async function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = updateLocks.get(uploadId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  // Keep the chain alive even when `fn` rejects, so a failed mutation never
  // deadlocks subsequent mutations for the same upload.
  updateLocks.set(
    uploadId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

type ProgressListener = (uploadId: string) => void;
const progressListeners = new Set<ProgressListener>();

/**
 * Subscribe to progress mutations. Used by the SSE route to push immediate
 * (instance-local) updates; cross-instance visibility comes from the SSE
 * loader's 1s heartbeat polling the shared store.
 */
export function subscribeToProgressUpdates(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function notifyProgressUpdate(uploadId: string): void {
  for (const listener of progressListeners) {
    listener(uploadId);
  }
}

/** Get upload progress for a session. */
export function getUploadProgress(uploadId: string): Promise<UploadProgressEntry | undefined> {
  return backend.get(uploadId);
}

/** Set upload progress for a session. */
export async function setUploadProgress(
  uploadId: string,
  progress: Omit<UploadProgressEntry, "lastUpdated">,
): Promise<void> {
  await withUploadLock(uploadId, async () => {
    await backend.set(uploadId, { ...progress, lastUpdated: Date.now() });
    notifyProgressUpdate(uploadId);
  });
}

/** Initialize upload progress for a session. */
export function initUploadProgress(uploadId: string, fileNames: string[]): Promise<void> {
  const files = fileNames.map((fileName, index) => ({
    fileId: `file-${index}`,
    fileName,
    progress: 0,
    status: "pending" as const,
  }));

  return setUploadProgress(uploadId, {
    files,
    overallProgress: 0,
    status: "active",
    startTime: Date.now(),
    successfulTracks: [],
    failedFiles: [],
  });
}

/** Update progress for a specific file. */
export async function updateFileProgress(
  uploadId: string,
  fileId: string,
  progress: number,
  status?: "processing" | "uploading" | "completed" | "failed",
  error?: string,
  fileSize?: number,
): Promise<void> {
  await withUploadLock(uploadId, async () => {
    const current = await backend.get(uploadId);
    if (!current) return;

    const file = current.files.find((f) => f.fileId === fileId);
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

    // Calculate overall progress.
    const totalProgress = current.files.reduce((sum, entry) => sum + entry.progress, 0);
    current.overallProgress = Math.round(totalProgress / current.files.length);

    // Update status if all files are completed or failed.
    const allCompleted = current.files.every(
      (f) => f.status === "completed" || f.status === "failed",
    );
    if (allCompleted) {
      const hasFailures = current.files.some((f) => f.status === "failed");
      current.status = hasFailures ? "failed" : "completed";
    }

    current.lastUpdated = Date.now();
    await backend.set(uploadId, current);
    notifyProgressUpdate(uploadId);
  });
}

/** Add a successful track to the progress store. */
export async function addSuccessfulTrack(
  uploadId: string,
  trackInfo: SuccessfulTrackInfo,
): Promise<void> {
  await withUploadLock(uploadId, async () => {
    const current = await backend.get(uploadId);
    if (!current) return;

    if (!current.successfulTracks) {
      current.successfulTracks = [];
    }
    current.successfulTracks.push(trackInfo);
    current.lastUpdated = Date.now();
    await backend.set(uploadId, current);
    notifyProgressUpdate(uploadId);
  });
}

/**
 * Add a failed file to the progress store. Intentionally stores no retry
 * buffer: the client re-uploads failed files from the browser, and audio
 * buffers (up to ~1GB per ZIP) cannot live in the shared store.
 */
export async function addFailedFile(
  uploadId: string,
  fileId: string,
  error: string,
): Promise<void> {
  await withUploadLock(uploadId, async () => {
    const current = await backend.get(uploadId);
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
    });
    current.lastUpdated = Date.now();
    await backend.set(uploadId, current);
    notifyProgressUpdate(uploadId);
  });
}

/** Remove a progress session (called when the completion screen is done). */
export async function deleteUploadProgress(uploadId: string): Promise<void> {
  await withUploadLock(uploadId, async () => {
    await backend.delete(uploadId);
  });
}

/**
 * Reclaim abandoned progress sessions so their buffers cannot accumulate
 * without bound. Memory backend: TTL + cap. Redis backend: no-op (native TTL).
 * Returns the number of sessions remaining after the sweep.
 */
export function cleanupOldProgress(options?: { now?: number; ttlMs?: number }): Promise<number> {
  return backend.sweep(options);
}

let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process TTL sweeper for upload progress. Idempotent: a second
 * call does not register another interval. No-op for the Redis backend, whose
 * EXPIRE already bounds retention.
 */
export function startUploadProgressSweeper(): void {
  if (!backend.needsSweeper()) return;
  if (cleanupIntervalHandle !== null) return;

  cleanupIntervalHandle = setInterval(() => {
    void cleanupOldProgress();
  }, UPLOAD_PROGRESS_CLEANUP_INTERVAL_MS);
}

/** Stop the sweeper (used by tests and shutdown paths). */
export function stopUploadProgressSweeper(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }
}

/** Reset the store between tests. */
export function resetUploadProgressStoreForTests(): void {
  backend.resetForTests?.();
  updateLocks.clear();
}

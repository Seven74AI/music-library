/**
 * Metadata clipboard shared across windows/tabs. Values are persisted to
 * localStorage (with an in-memory fallback for environments without storage)
 * and the `storage` event keeps this tab's copy in sync with other tabs.
 */

export const CLIPBOARD_FIELDS = [
  "artist",
  "album",
  "genre",
  "year",
  "albumArtist",
  "bpm",
  "label",
] as const;

export type ClipboardField = (typeof CLIPBOARD_FIELDS)[number];

export const CLIPBOARD_FIELD_LABELS: Record<ClipboardField, string> = {
  artist: "Artist",
  album: "Album",
  genre: "Genre",
  year: "Year",
  albumArtist: "Album artist",
  bpm: "BPM",
  label: "Label",
};

export type MetadataClipboard = {
  artistId: string | null;
  artistName: string | null;
  albumId: string | null;
  albumName: string | null;
  genre: string | null;
  genreIds: string[];
  year: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
};

export type ClipboardTrack = {
  title: string;
  artistId: string;
  artistName: string;
  albumId: string | null;
  albumName: string | null;
  genre: string | null;
  genreIds: string[];
  year: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
};

export type TrackEditPayload = {
  title: string;
  artistId: string;
  albumId: string | null;
  genre: string | null;
  genreIds: string[];
  year: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
  comment: string;
};

type DetailsTrack = {
  title: string;
  artist: { id: string; name: string };
  albumRecord: { id: string; name: string } | null;
  genre: string | null;
  genres?: Array<{ id: string; name: string }>;
  year: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
};

const CLIPBOARD_STORAGE_KEY = "curator:metadata-clipboard";

let clipboard: MetadataClipboard | null = null;

function parseClipboard(raw: string): MetadataClipboard | null {
  try {
    return JSON.parse(raw) as MetadataClipboard;
  } catch {
    return null;
  }
}

function readStoredClipboard(): MetadataClipboard | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    const raw = globalThis.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    return raw ? parseClipboard(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredClipboard(value: MetadataClipboard | null): void {
  try {
    if (typeof globalThis.localStorage === "undefined") return;
    if (value === null) {
      globalThis.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } else {
      globalThis.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Storage may be unavailable (private mode / quota). In-memory copy still works.
  }
}

// Keep this tab's in-memory copy in sync with copies made in other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== CLIPBOARD_STORAGE_KEY) return;
    clipboard = event.newValue ? parseClipboard(event.newValue) : null;
  });
}

export function copyMetadata(value: MetadataClipboard) {
  clipboard = value;
  writeStoredClipboard(value);
}

export function peekMetadataClipboard(): MetadataClipboard | null {
  // Prefer localStorage so a copy made in another tab is visible here.
  return readStoredClipboard() ?? clipboard;
}

export function clearMetadataClipboard() {
  clipboard = null;
  writeStoredClipboard(null);
}

export function clipboardFromTrackDetails(track: DetailsTrack): MetadataClipboard {
  return {
    artistId: track.artist.id,
    artistName: track.artist.name,
    albumId: track.albumRecord?.id ?? null,
    albumName: track.albumRecord?.name ?? null,
    genre: track.genre,
    genreIds: track.genres?.map((genre) => genre.id) ?? [],
    year: track.year,
    albumArtist: track.albumArtist,
    bpm: track.bpm,
    label: track.label,
  };
}

export function trackFromDetails(track: DetailsTrack): ClipboardTrack {
  const copied = clipboardFromTrackDetails(track);
  return {
    title: track.title,
    artistId: copied.artistId ?? "",
    artistName: copied.artistName ?? "",
    albumId: copied.albumId,
    albumName: copied.albumName,
    genre: copied.genre,
    genreIds: copied.genreIds,
    year: copied.year,
    albumArtist: copied.albumArtist,
    bpm: copied.bpm,
    label: copied.label,
  };
}

export function formatClipboardField(value: MetadataClipboard, field: ClipboardField): string {
  if (field === "artist") return value.artistName?.trim() || "None";
  if (field === "album") return value.albumName?.trim() || "None";
  if (field === "genre") return value.genre?.trim() || "None";
  if (field === "year") return value.year == null ? "None" : String(value.year);
  if (field === "albumArtist") return value.albumArtist?.trim() || "None";
  if (field === "bpm") return value.bpm == null ? "None" : String(value.bpm);
  return value.label?.trim() || "None";
}

/**
 * Build the JSON body for POST /api/metadata/tracks/:trackId/edit.
 * Unselected clipboard fields keep the target track's current values.
 * Title is always sent because the edit endpoint requires it.
 */
export function buildPastePayload(
  current: ClipboardTrack,
  source: MetadataClipboard,
  fields: readonly ClipboardField[],
): TrackEditPayload {
  const selected = new Set(fields);
  const artistId = selected.has("artist") && source.artistId ? source.artistId : current.artistId;
  return {
    title: current.title,
    artistId,
    albumId: selected.has("album") ? source.albumId : current.albumId,
    genre: selected.has("genre") ? source.genre : current.genre,
    genreIds: selected.has("genre") ? source.genreIds : current.genreIds,
    year: selected.has("year") ? source.year : current.year,
    albumArtist: selected.has("albumArtist") ? source.albumArtist : current.albumArtist,
    bpm: selected.has("bpm") ? source.bpm : current.bpm,
    label: selected.has("label") ? source.label : current.label,
    comment: "Pasted metadata",
  };
}

export function pasteMetadataRequest(trackId: string, payload: TrackEditPayload) {
  return {
    url: `/api/metadata/tracks/${encodeURIComponent(trackId)}/edit`,
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function isRetryableRequestError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = (error as { status?: number }).status;
  return typeof status !== "number" || status >= 500;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retry = attempt < attempts - 1 && isRetryableRequestError(error);
      if (!retry) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

function httpError(status: number): Error {
  const error = new Error(`Request failed (${status})`);
  (error as Error & { status: number }).status = status;
  return error;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw httpError(response.status);
  return response.json() as Promise<unknown>;
}

function detailsTrack(body: unknown): DetailsTrack | null {
  if (!body || typeof body !== "object" || !("track" in body)) return null;
  const track = (body as { track?: DetailsTrack }).track;
  if (!track?.title || !track.artist?.id) return null;
  return track;
}

export async function fetchTrackForClipboard(
  trackId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DetailsTrack> {
  const body = await retryWithBackoff(async () => {
    const response = await fetchImpl(
      `/resources/track-details?trackId=${encodeURIComponent(trackId)}`,
      { credentials: "same-origin", headers: { Accept: "application/json" } },
    );
    return readJson(response);
  });
  const track = detailsTrack(body);
  if (!track) throw new Error("Track details were not available");
  return track;
}

export async function pasteSelectedMetadata(
  trackId: string,
  fields: readonly ClipboardField[],
  fetchImpl: typeof fetch = fetch,
): Promise<TrackEditPayload> {
  const source = peekMetadataClipboard();
  if (!source) throw new Error("Copy metadata from a track first");
  const current = trackFromDetails(await fetchTrackForClipboard(trackId, fetchImpl));
  const payload = buildPastePayload(current, source, fields);
  const request = pasteMetadataRequest(trackId, payload);
  await retryWithBackoff(async () => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      credentials: "same-origin",
      headers: request.headers,
      body: request.body,
    });
    return readJson(response);
  });
  return payload;
}

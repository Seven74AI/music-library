export type CachedPlaylistMeta = {
  id: string;
  title: string;
  description: string | null;
  updatedAt: number;
};

const STORAGE_KEY = "music-library-offline-playlists";

function readAll(): Record<string, CachedPlaylistMeta> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CachedPlaylistMeta>;
  } catch {
    return {};
  }
}

function writeAll(playlists: Record<string, CachedPlaylistMeta>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
}

export function cachePlaylistMetadata(meta: CachedPlaylistMeta) {
  const all = readAll();
  all[meta.id] = meta;
  writeAll(all);
}

export function getCachedPlaylistMetadata(playlistId: string): CachedPlaylistMeta | null {
  return readAll()[playlistId] ?? null;
}

export function listCachedPlaylists(): CachedPlaylistMeta[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function clearCachedPlaylistMetadataForTests() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

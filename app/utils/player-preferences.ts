export const PLAYER_VOLUME_STORAGE_KEY = "music-library:player-volume";

export const DEFAULT_PLAYER_VOLUME = 1;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYER_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_PLAYER_VOLUME;

  try {
    const raw = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_PLAYER_VOLUME;
    return clampVolume(Number.parseFloat(raw));
  } catch {
    return DEFAULT_PLAYER_VOLUME;
  }
}

export function writeStoredVolume(volume: number): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(clampVolume(volume)));
  } catch {
    // Ignore quota / private mode errors
  }
}

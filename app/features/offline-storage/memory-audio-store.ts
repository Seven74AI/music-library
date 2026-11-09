export type OfflineAudioStore = {
  write: (trackId: string, data: ArrayBuffer, format?: string | null) => Promise<void>;
  commitStagingWrite: (
    stagingTrackId: string,
    trackId: string,
    format?: string | null,
  ) => Promise<void>;
  read: (trackId: string, format?: string | null) => Promise<ArrayBuffer | null>;
  delete: (trackId: string, format?: string | null) => Promise<void>;
  has: (trackId: string, format?: string | null) => Promise<boolean>;
};

function memoryAudioKey(trackId: string, format?: string | null): string {
  return `${trackId}\0${format ?? "mp3"}`;
}

export function createMemoryOfflineAudioStore(): OfflineAudioStore {
  const files = new Map<string, ArrayBuffer>();

  return {
    async write(trackId, data, format) {
      files.set(memoryAudioKey(trackId, format), data.slice(0));
    },
    async commitStagingWrite(stagingTrackId, trackId, format) {
      const key = memoryAudioKey(stagingTrackId, format);
      const data = files.get(key);
      if (!data) {
        throw new Error("missing staging write");
      }
      files.set(memoryAudioKey(trackId, format), data.slice(0));
      files.delete(key);
    },
    async read(trackId, format) {
      const data = files.get(memoryAudioKey(trackId, format));
      return data ? data.slice(0) : null;
    },
    async delete(trackId, format) {
      files.delete(memoryAudioKey(trackId, format));
    },
    async has(trackId, format) {
      return files.has(memoryAudioKey(trackId, format));
    },
  };
}

export type OfflineAudioStore = {
  write: (trackId: string, data: ArrayBuffer, format?: string | null) => Promise<void>;
  read: (trackId: string, format?: string | null) => Promise<ArrayBuffer | null>;
  delete: (trackId: string, format?: string | null) => Promise<void>;
  has: (trackId: string, format?: string | null) => Promise<boolean>;
};

export function createMemoryOfflineAudioStore(): OfflineAudioStore {
  const files = new Map<string, ArrayBuffer>();

  return {
    async write(trackId, data) {
      files.set(trackId, data.slice(0));
    },
    async read(trackId) {
      const data = files.get(trackId);
      return data ? data.slice(0) : null;
    },
    async delete(trackId) {
      files.delete(trackId);
    },
    async has(trackId) {
      return files.has(trackId);
    },
  };
}

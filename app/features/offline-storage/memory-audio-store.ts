export type OfflineAudioStore = {
  write: (trackId: string, data: ArrayBuffer) => Promise<void>;
  read: (trackId: string) => Promise<ArrayBuffer | null>;
  delete: (trackId: string) => Promise<void>;
  has: (trackId: string) => Promise<boolean>;
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

import { type OfflineAudioStore } from "./memory-audio-store.ts";

type WorkerRequest = {
  type: string;
  trackId: string;
  buffer?: ArrayBuffer;
  format?: string | null;
};

type WorkerResponse =
  | {
      id: number;
      ok: true;
      buffer?: ArrayBuffer;
      exists?: boolean;
      supported?: boolean;
    }
  | { id: number; ok: false; error: string };

export function createOpfsOfflineAudioStore(): OfflineAudioStore {
  const worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), {
    type: "module",
  });

  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: WorkerResponse) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const handlers = pending.get(response.id);
    if (!handlers) return;
    pending.delete(response.id);
    if (response.ok) {
      handlers.resolve(response);
    } else {
      handlers.reject(new Error(response.error));
    }
  });

  function callWorker(message: WorkerRequest): Promise<WorkerResponse> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, message.buffer ? [message.buffer] : []);
    });
  }

  return {
    async write(trackId, data, format) {
      const response = await callWorker({ type: "write", trackId, buffer: data, format });
      if (!response.ok) throw new Error("write failed");
    },
    async read(trackId, format) {
      const response = await callWorker({ type: "read", trackId, format });
      if (!response.ok) throw new Error("read failed");
      return response.buffer ?? null;
    },
    async delete(trackId, format) {
      const response = await callWorker({ type: "delete", trackId, format });
      if (!response.ok) throw new Error("delete failed");
    },
    async has(trackId, format) {
      const response = await callWorker({ type: "has", trackId, format });
      if (!response.ok) throw new Error("has failed");
      return Boolean(response.exists);
    },
  };
}

export async function isOpfsAudioStoreSupported(): Promise<boolean> {
  if (typeof Worker === "undefined") {
    return false;
  }

  try {
    const worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), {
      type: "module",
    });

    try {
      return await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 2000);

        worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
          const response = event.data;
          if (response.id !== 0) return;
          clearTimeout(timeout);
          resolve(response.ok && response.supported === true);
        });

        worker.addEventListener("error", () => {
          clearTimeout(timeout);
          resolve(false);
        });

        worker.postMessage({ type: "probe", id: 0 });
      });
    } finally {
      worker.terminate();
    }
  } catch {
    return false;
  }
}

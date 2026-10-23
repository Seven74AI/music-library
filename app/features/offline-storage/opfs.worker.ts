/// <reference lib="webworker" />

import { deleteOfflineAudioEntry } from "./opfs-delete.ts";
import { offlineAudioOpfsPath } from "./offline-audio-path.ts";
import { isOpfsSupportedInWorkerScope } from "./opfs-worker-support.ts";

type WorkerRequest =
  | { id: number; type: "probe" }
  | { id: number; type: "write"; trackId: string; buffer: ArrayBuffer; format?: string | null }
  | { id: number; type: "read"; trackId: string; format?: string | null }
  | { id: number; type: "delete"; trackId: string; format?: string | null }
  | { id: number; type: "has"; trackId: string; format?: string | null };

type WorkerResponse =
  | { id: number; ok: true; buffer?: ArrayBuffer; exists?: boolean; supported?: boolean }
  | { id: number; ok: false; error: string };

declare const self: DedicatedWorkerGlobalScope;

/** Leaf file name inside the OPFS `audio/` directory, format-aware. */
function opfsFileName(trackId: string, format: string | null | undefined): string {
  const path = offlineAudioOpfsPath(trackId, format);
  return path.slice(path.lastIndexOf("/") + 1);
}

async function getFileHandle(trackId: string, format: string | null | undefined, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const audioDir = await root.getDirectoryHandle("audio", { create: true });
  return audioDir.getFileHandle(opfsFileName(trackId, format), { create });
}

async function writeTrack(trackId: string, buffer: ArrayBuffer, format: string | null | undefined) {
  const handle = await getFileHandle(trackId, format, true);
  const accessHandle = await handle.createSyncAccessHandle();
  try {
    accessHandle.truncate(0);
    accessHandle.write(buffer, { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
}

async function readTrack(trackId: string, format: string | null | undefined) {
  const handle = await getFileHandle(trackId, format, false);
  const accessHandle = await handle.createSyncAccessHandle();
  try {
    const size = accessHandle.getSize();
    const buffer = new ArrayBuffer(size);
    accessHandle.read(buffer, { at: 0 });
    return buffer;
  } finally {
    accessHandle.close();
  }
}

async function deleteTrack(trackId: string, format: string | null | undefined) {
  const root = await navigator.storage.getDirectory();
  await deleteOfflineAudioEntry(root, trackId, format);
}

async function hasTrack(trackId: string, format: string | null | undefined) {
  try {
    await getFileHandle(trackId, format, false);
    return true;
  } catch {
    return false;
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  void (async () => {
    try {
      switch (message.type) {
        case "probe":
          self.postMessage({
            id: message.id,
            ok: true,
            supported: isOpfsSupportedInWorkerScope(),
          } satisfies WorkerResponse);
          break;
        case "write":
          await writeTrack(message.trackId, message.buffer, message.format);
          self.postMessage({ id: message.id, ok: true } satisfies WorkerResponse);
          break;
        case "read": {
          const buffer = await readTrack(message.trackId, message.format);
          self.postMessage({ id: message.id, ok: true, buffer } satisfies WorkerResponse, [buffer]);
          break;
        }
        case "delete":
          await deleteTrack(message.trackId, message.format);
          self.postMessage({ id: message.id, ok: true } satisfies WorkerResponse);
          break;
        case "has": {
          const exists = await hasTrack(message.trackId, message.format);
          self.postMessage({ id: message.id, ok: true, exists } satisfies WorkerResponse);
          break;
        }
        default:
          throw new Error("Unknown worker message");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({
        id: message.id,
        ok: false,
        error: errorMessage,
      } satisfies WorkerResponse);
    }
  })();
});

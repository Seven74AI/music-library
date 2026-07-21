/// <reference lib="webworker" />

import { offlineAudioOpfsPath } from "./offline-audio-path.ts";

type WorkerRequest =
  | { id: number; type: "write"; trackId: string; buffer: ArrayBuffer }
  | { id: number; type: "read"; trackId: string }
  | { id: number; type: "delete"; trackId: string }
  | { id: number; type: "has"; trackId: string };

type WorkerResponse =
  | { id: number; ok: true; buffer?: ArrayBuffer; exists?: boolean }
  | { id: number; ok: false; error: string };

declare const self: DedicatedWorkerGlobalScope;

let nextRequestId = 1;

async function getFileHandle(trackId: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const audioDir = await root.getDirectoryHandle("audio", { create: true });
  return audioDir.getFileHandle(`${trackId}.mp3`, { create });
}

async function writeTrack(trackId: string, buffer: ArrayBuffer) {
  const handle = await getFileHandle(trackId, true);
  const accessHandle = await handle.createSyncAccessHandle();
  try {
    accessHandle.truncate(0);
    accessHandle.write(buffer, { at: 0 });
    accessHandle.flush();
  } finally {
    accessHandle.close();
  }
  void offlineAudioOpfsPath(trackId);
}

async function readTrack(trackId: string) {
  const handle = await getFileHandle(trackId, false);
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

async function deleteTrack(trackId: string) {
  const root = await navigator.storage.getDirectory();
  const audioDir = await root.getDirectoryHandle("audio", { create: false });
  await audioDir.removeEntry(`${trackId}.mp3`);
}

async function hasTrack(trackId: string) {
  try {
    await getFileHandle(trackId, false);
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
        case "write":
          await writeTrack(message.trackId, message.buffer);
          self.postMessage({ id: message.id, ok: true } satisfies WorkerResponse);
          break;
        case "read": {
          const buffer = await readTrack(message.trackId);
          self.postMessage({ id: message.id, ok: true, buffer } satisfies WorkerResponse, [buffer]);
          break;
        }
        case "delete":
          await deleteTrack(message.trackId);
          self.postMessage({ id: message.id, ok: true } satisfies WorkerResponse);
          break;
        case "has": {
          const exists = await hasTrack(message.trackId);
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

void nextRequestId;

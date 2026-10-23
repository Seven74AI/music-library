type OpfsScope = {
  navigator?: { storage?: { getDirectory?: unknown } };
  FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
};

/**
 * Feature-detects the OPFS surface the audio store actually uses inside its
 * Web Worker.
 *
 * The store never touches `navigator.storage` on the main thread: every write
 * and read goes through `opfs.worker.ts`, which calls
 * `navigator.storage.getDirectory()` and then
 * `FileSystemFileHandle.createSyncAccessHandle()`. That second API is the one
 * that actually distinguishes platforms — it is exposed ONLY inside dedicated
 * Web Workers (never on the main thread) and was the surface that diverged on
 * iOS Safari (WebKit bug 251460, broken until Safari 16.4).
 *
 * So a support probe must check BOTH APIs in the worker scope, not the main
 * thread's `navigator.storage.getDirectory` alone.
 */
export function isOpfsSupportedInWorkerScope(
  scope: OpfsScope = globalThis as unknown as OpfsScope,
): boolean {
  const getDirectory = scope.navigator?.storage?.getDirectory;
  if (typeof getDirectory !== "function") return false;

  const createSyncAccessHandle = scope.FileSystemFileHandle?.prototype?.createSyncAccessHandle;
  return typeof createSyncAccessHandle === "function";
}

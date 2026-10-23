import { describe, expect, test, vi } from "vitest";
import { deleteOfflineAudioEntry } from "./opfs-delete.ts";

function notFoundError(): DOMException {
  return new DOMException("not found", "NotFoundError");
}

describe("deleteOfflineAudioEntry", () => {
  test("no-ops when the audio directory is absent", async () => {
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(notFoundError()),
    } as unknown as FileSystemDirectoryHandle;

    await expect(deleteOfflineAudioEntry(root, "track-1")).resolves.toBeUndefined();
    expect(root.getDirectoryHandle).toHaveBeenCalledWith("audio", { create: false });
  });

  test("no-ops when the file is already gone", async () => {
    const audioDir = {
      removeEntry: vi.fn().mockRejectedValue(notFoundError()),
    };
    const root = {
      getDirectoryHandle: vi.fn().mockResolvedValue(audioDir),
    } as unknown as FileSystemDirectoryHandle;

    await expect(deleteOfflineAudioEntry(root, "track-1")).resolves.toBeUndefined();
    expect(audioDir.removeEntry).toHaveBeenCalledWith("track-1.mp3");
  });

  test("removes an existing file", async () => {
    const audioDir = {
      removeEntry: vi.fn().mockResolvedValue(undefined),
    };
    const root = {
      getDirectoryHandle: vi.fn().mockResolvedValue(audioDir),
    } as unknown as FileSystemDirectoryHandle;

    await deleteOfflineAudioEntry(root, "track-1");
    expect(audioDir.removeEntry).toHaveBeenCalledWith("track-1.mp3");
  });

  test("rethrows non-NotFound errors from the directory lookup", async () => {
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as FileSystemDirectoryHandle;

    await expect(deleteOfflineAudioEntry(root, "track-1")).rejects.toThrow("boom");
  });

  test("rethrows non-NotFound errors from removeEntry", async () => {
    const audioDir = {
      removeEntry: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const root = {
      getDirectoryHandle: vi.fn().mockResolvedValue(audioDir),
    } as unknown as FileSystemDirectoryHandle;

    await expect(deleteOfflineAudioEntry(root, "track-1")).rejects.toThrow("boom");
  });
});

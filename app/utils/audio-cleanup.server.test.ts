import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";
import {
  cleanupFailedUploadArtifacts,
  deleteUnreferencedObjectKeys,
} from "./audio-cleanup.server.ts";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    trackAudioFile: {
      findMany: vi.fn(),
    },
    coverImage: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("#app/utils/storage.server.ts", () => ({
  deleteFile: vi.fn(),
}));

const findMany = vi.mocked(prisma.trackAudioFile.findMany);
const coverFindFirst = vi.mocked(prisma.coverImage.findFirst);
const deleteFileMock = vi.mocked(deleteFile);

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  coverFindFirst.mockResolvedValue(null);
  deleteFileMock.mockResolvedValue(undefined);
});

describe("cleanupFailedUploadArtifacts", () => {
  test("deletes newly uploaded audio and cover keys, not hash-reused audio", async () => {
    await cleanupFailedUploadArtifacts(
      {
        objectKey: "audio/tracks/local/new.mp3",
        contentHash: "h",
        audioFingerprint: null,
        isDuplicate: false,
      },
      {
        kind: "new",
        objectKey: "covers/new.jpg",
        contentHash: "ch",
        width: 1,
        height: 1,
        format: "jpg",
        fileSize: 1,
      },
    );

    expect(deleteFileMock).toHaveBeenCalledWith("covers/new.jpg");
    expect(deleteFileMock).toHaveBeenCalledWith("audio/tracks/local/new.mp3");
  });

  test("does not delete a cover after the upload transaction committed", async () => {
    coverFindFirst.mockResolvedValue({ id: "cover-1" } as never);
    await cleanupFailedUploadArtifacts(
      null,
      {
        kind: "new",
        objectKey: "covers/live.jpg",
        contentHash: "ch",
        width: 1,
        height: 1,
        format: "jpg",
        fileSize: 1,
      },
      { transactionCommitted: true },
    );
    expect(deleteFileMock).not.toHaveBeenCalledWith("covers/live.jpg");
  });

  test("skips audio cleanup when the upload reused an existing object", async () => {
    await cleanupFailedUploadArtifacts(
      {
        objectKey: "audio/tracks/local/existing.mp3",
        contentHash: "h",
        audioFingerprint: null,
        isDuplicate: true,
      },
      null,
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteFileMock).not.toHaveBeenCalled();
  });
});

describe("deleteUnreferencedObjectKeys", () => {
  test("resolves all keys in a single batched query", async () => {
    await deleteUnreferencedObjectKeys(["a", "b", "c"]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { objectKey: { in: ["a", "b", "c"] } },
      select: { objectKey: true },
      distinct: ["objectKey"],
    });
  });

  test("deletes only keys that are not referenced", async () => {
    findMany.mockResolvedValue([{ objectKey: "a" }] as never);
    await deleteUnreferencedObjectKeys(["a", "b", "c"]);
    expect(deleteFileMock).toHaveBeenCalledTimes(2);
    expect(deleteFileMock).toHaveBeenCalledWith("b");
    expect(deleteFileMock).toHaveBeenCalledWith("c");
    expect(deleteFileMock).not.toHaveBeenCalledWith("a");
  });

  test("dedupes duplicate keys before querying and deleting", async () => {
    await deleteUnreferencedObjectKeys(["a", "a", "b", "b"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { objectKey: { in: ["a", "b"] } },
      select: { objectKey: true },
      distinct: ["objectKey"],
    });
    expect(deleteFileMock).toHaveBeenCalledTimes(2);
  });

  test("no-ops on empty input", async () => {
    await deleteUnreferencedObjectKeys([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  test("logs and continues when a delete fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    deleteFileMock.mockRejectedValueOnce(new Error("S3 down"));
    await deleteUnreferencedObjectKeys(["a", "b"]);
    expect(deleteFileMock).toHaveBeenCalledTimes(2);
    expect(deleteFileMock).toHaveBeenCalledWith("b");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

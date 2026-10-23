import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";
import { deleteUnreferencedObjectKeys } from "./audio-cleanup.server.ts";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    trackAudioFile: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("#app/utils/storage.server.ts", () => ({
  deleteFile: vi.fn(),
}));

const findMany = vi.mocked(prisma.trackAudioFile.findMany);
const deleteFileMock = vi.mocked(deleteFile);

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  deleteFileMock.mockResolvedValue(undefined);
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

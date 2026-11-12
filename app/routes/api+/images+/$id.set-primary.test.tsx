import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  assertEditLockInTransaction,
  findWriteBlockedLock,
  getLockStatus,
} from "#app/utils/locks.server.ts";
import { requireCuratorOrAdmin } from "#app/utils/permissions.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { action } from "./$id.set-primary.tsx";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireCuratorOrAdmin: vi.fn(),
}));

vi.mock("#app/utils/locks.server.ts", () => ({
  findWriteBlockedLock: vi.fn(),
  getLockStatus: vi.fn(),
  assertEditLockInTransaction: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    coverImage: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

function makeRequest(body: unknown, imageId = "img-1") {
  return {
    request: new Request(`http://localhost/api/images/${imageId}/set-primary`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: imageId },
  };
}

describe("PUT /api/images/:id/set-primary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorOrAdmin).mockResolvedValue("user-1");
    vi.mocked(findWriteBlockedLock).mockResolvedValue(null);
    vi.mocked(getLockStatus).mockResolvedValue(null);
    vi.mocked(assertEditLockInTransaction).mockResolvedValue(undefined);
    vi.mocked(prisma.coverImage.findUnique).mockResolvedValue({
      id: "img-1",
      objectKey: "covers/test.png",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({
        artist: {
          findUnique: vi.fn().mockResolvedValue({ id: "artist-1" }),
          update: vi.fn(),
        },
        album: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      } as never),
    );
  });

  test("returns 409 when the target artist is locked by another curator", async () => {
    vi.mocked(findWriteBlockedLock).mockResolvedValue({
      id: "lock-1",
      entityType: "artist",
      entityId: "artist-1",
      lockedBy: "other",
      lockedByName: "Ada",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    let response: {
      type: string;
      data: { error?: string };
      init: { status?: number } | null;
    };
    try {
      response = (await action(
        makeRequest({ entityType: "artist", entityId: "artist-1" }) as never,
      )) as typeof response;
    } catch (thrown) {
      response = thrown as typeof response;
    }

    expect(response.type).toBe("DataWithResponseInit");
    expect(response.init?.status).toBe(409);
    expect(response.data.error).toBe("Locked");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "./db.server.ts";
import { acquireLock } from "./locks.server.ts";

vi.mock("./db.server.ts", () => ({
  prisma: {
    editLock: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const lockUser = { id: "user-1", name: "Alice", username: "alice" };
const otherUser = { id: "user-2", name: "Bob", username: "bob" };

function lockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lock-1",
    entityType: "track",
    entityId: "track-1",
    lockedBy: "user-1",
    user: lockUser,
    acquiredAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-01-01T00:30:00Z"),
    ...overrides,
  };
}

describe("acquireLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.editLock.deleteMany).mockResolvedValue({ count: 0 });
  });

  test("returns null when a concurrent create wins the race (P2002)", async () => {
    vi.mocked(prisma.editLock.findUnique).mockResolvedValueOnce(null); // initial check
    vi.mocked(prisma.editLock.create).mockRejectedValue({ code: "P2002" });
    // Winner of the race is a different user.
    vi.mocked(prisma.editLock.findUnique).mockResolvedValueOnce(
      lockRow({ lockedBy: "user-2", user: otherUser }),
    );

    const result = await acquireLock("track", "track-1", "user-1");

    expect(result).toBeNull();
    expect(prisma.editLock.create).toHaveBeenCalledTimes(1);
  });

  test("extends the winner lock when the concurrent create is the same user", async () => {
    vi.mocked(prisma.editLock.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.editLock.create).mockRejectedValue({ code: "P2002" });
    vi.mocked(prisma.editLock.findUnique).mockResolvedValueOnce(lockRow());
    vi.mocked(prisma.editLock.update).mockResolvedValue(
      lockRow({ expiresAt: new Date("2026-01-01T01:00:00Z") }),
    );

    const result = await acquireLock("track", "track-1", "user-1");

    expect(result).not.toBeNull();
    expect(result?.lockedBy).toBe("user-1");
    expect(prisma.editLock.update).toHaveBeenCalledTimes(1);
  });

  test("rethrows errors that are not unique-constraint violations", async () => {
    vi.mocked(prisma.editLock.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.editLock.create).mockRejectedValue(new Error("boom"));

    await expect(acquireLock("track", "track-1", "user-1")).rejects.toThrow("boom");
  });
});

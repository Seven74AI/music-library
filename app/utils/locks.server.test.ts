import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { forceUnlock, releaseLock } from "./locks.server.ts";
import { createUser } from "#tests/db-utils.ts";

describe("forceUnlock", () => {
  beforeEach(async () => {
    await prisma.securityEvent.deleteMany();
    await prisma.editLock.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("deletes the lock and records the reason in the audit trail", async () => {
    const owner = await prisma.user.create({ data: createUser() });
    const actor = await prisma.user.create({ data: createUser() });

    await prisma.editLock.create({
      data: {
        entityType: "track",
        entityId: "track-123",
        lockedBy: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await forceUnlock(
      "track",
      "track-123",
      "Curator inactive, urgent fix",
      actor.id,
    );

    expect(result).toBe(true);
    expect(
      await prisma.editLock.findUnique({
        where: { entityType_entityId: { entityType: "track", entityId: "track-123" } },
      }),
    ).toBeNull();

    const event = await prisma.securityEvent.findFirst({
      where: { eventType: "force_unlock" },
    });
    expect(event).not.toBeNull();
    expect(event?.userId).toBe(actor.id);
    expect(event?.targetUserId).toBe(owner.id);
    const metadata = JSON.parse(event?.metadata ?? "{}") as {
      entityType?: string;
      entityId?: string;
      reason?: string;
    };
    expect(metadata.entityType).toBe("track");
    expect(metadata.entityId).toBe("track-123");
    expect(metadata.reason).toBe("Curator inactive, urgent fix");
  });

  test("returns false and writes no audit event when no lock exists", async () => {
    const actor = await prisma.user.create({ data: createUser() });

    const result = await forceUnlock("album", "album-404", "no lock", actor.id);

    expect(result).toBe(false);
    expect(await prisma.securityEvent.count({ where: { eventType: "force_unlock" } })).toBe(0);
  });
});

describe("releaseLock", () => {
  beforeEach(async () => {
    await prisma.editLock.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("returns not_found when no lock exists", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const result = await releaseLock("track", "track-none", user.id);

    expect(result).toBe("not_found");
  });

  test("returns not_owner and keeps the lock when locked by someone else", async () => {
    const owner = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    await prisma.editLock.create({
      data: {
        entityType: "track",
        entityId: "track-123",
        lockedBy: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await releaseLock("track", "track-123", other.id);

    expect(result).toBe("not_owner");
    expect(
      await prisma.editLock.findUnique({
        where: { entityType_entityId: { entityType: "track", entityId: "track-123" } },
      }),
    ).not.toBeNull();
  });

  test("returns released and deletes the lock when owned by the caller", async () => {
    const owner = await prisma.user.create({ data: createUser() });
    await prisma.editLock.create({
      data: {
        entityType: "track",
        entityId: "track-123",
        lockedBy: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await releaseLock("track", "track-123", owner.id);

    expect(result).toBe("released");
    expect(
      await prisma.editLock.findUnique({
        where: { entityType_entityId: { entityType: "track", entityId: "track-123" } },
      }),
    ).toBeNull();
  });
});

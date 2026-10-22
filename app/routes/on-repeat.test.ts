import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader as historyLoader } from "./on-repeat.index.tsx";
import { loader as detailLoader } from "./on-repeat.$snapshotId.tsx";

async function createUserCookie() {
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      roles: { connect: { name: "user" } },
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expirationDate: getSessionExpirationDate(),
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return {
    userId: user.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

async function createTrack(title: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
      },
    },
  });
}

describe("on-repeat route loaders", () => {
  beforeEach(async () => {
    await prisma.onRepeatSnapshotTrack.deleteMany();
    await prisma.onRepeatSnapshot.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  test("history loader returns snapshots newest first", async () => {
    const { userId, cookie } = await createUserCookie();
    const track = await createTrack("Hit");
    await prisma.onRepeatSnapshot.create({
      data: {
        userId,
        yearMonth: "2026-07",
        tracks: { create: [{ trackId: track.id, position: 0, listenCount: 2 }] },
      },
    });
    await prisma.onRepeatSnapshot.create({
      data: {
        userId,
        yearMonth: "2026-08",
        tracks: { create: [{ trackId: track.id, position: 0, listenCount: 4 }] },
      },
    });

    const result = await historyLoader({
      request: new Request("http://localhost/on-repeat", { headers: { cookie } }),
      params: {},
      context: {} as never,
      url: new URL("http://localhost/on-repeat"),
      pattern: "/on-repeat",
    });

    expect(result.items.map((s: { yearMonth: string }) => s.yearMonth)).toEqual([
      "2026-08",
      "2026-07",
    ]);
  });

  test("detail loader includes listen counts", async () => {
    const { userId, cookie } = await createUserCookie();
    const track = await createTrack("Hit");
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId,
        yearMonth: "2026-08",
        tracks: { create: [{ trackId: track.id, position: 0, listenCount: 7 }] },
      },
    });

    const result = await detailLoader({
      request: new Request(`http://localhost/on-repeat/${snapshot.id}`, {
        headers: { cookie },
      }),
      params: { snapshotId: snapshot.id },
      context: {} as never,
      url: new URL(`http://localhost/on-repeat/${snapshot.id}`),
      pattern: "/on-repeat/:snapshotId",
    });

    const payload = (result as { data: { snapshot: { tracks: Array<{ listenCount: number }> } } })
      .data;
    expect(payload.snapshot.tracks[0]?.listenCount).toBe(7);
  });

  test("detail loader 404s for another user's snapshot", async () => {
    const owner = await createUserCookie();
    const other = await createUserCookie();
    const track = await createTrack("Hit");
    const snapshot = await prisma.onRepeatSnapshot.create({
      data: {
        userId: owner.userId,
        yearMonth: "2026-08",
        tracks: { create: [{ trackId: track.id, position: 0, listenCount: 1 }] },
      },
    });

    await expect(
      detailLoader({
        request: new Request(`http://localhost/on-repeat/${snapshot.id}`, {
          headers: { cookie: other.cookie },
        }),
        params: { snapshotId: snapshot.id },
        context: {} as never,
        url: new URL(`http://localhost/on-repeat/${snapshot.id}`),
        pattern: "/on-repeat/:snapshotId",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

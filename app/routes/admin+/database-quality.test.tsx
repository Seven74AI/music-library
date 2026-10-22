/**
 * Unit tests for the database-quality admin page loader.
 */
import { parseString } from "set-cookie-parser";
import { expect, test, beforeEach } from "vitest";
import { percentOfTracksAffected } from "#app/features/admin/database-quality.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./database-quality.tsx";

async function createAdminSession() {
  const user = await prisma.user.create({
    select: { id: true, username: true, name: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
}

async function createTestData() {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `Test Artist ${uniqueId}`,
      normalizedName: `test-artist-${uniqueId}`,
    },
  });

  const service = await prisma.service.create({
    data: {
      name: `test-service-${uniqueId}`,
      displayName: `Test Service ${uniqueId}`,
      baseUrl: "https://test.com",
    },
  });

  await prisma.track.createMany({
    data: [
      {
        title: "Complete Track",
        artistId: artist.id,
        serviceId: service.id,
        externalId: `complete-${uniqueId}`,
        duration: 180000,
        year: 2020,
        genre: "Rock",
        lyrics: "Test lyrics",
      },
      {
        title: "Track With Audio",
        artistId: artist.id,
        serviceId: service.id,
        externalId: `audio-${uniqueId}`,
        duration: 200000,
        year: 2021,
      },
    ],
  });

  const trackWithAudio = await prisma.track.findFirst({
    where: { externalId: `audio-${uniqueId}` },
  });
  if (trackWithAudio) {
    await prisma.trackAudioFile.create({
      data: {
        trackId: trackWithAudio.id,
        serviceId: service.id,
        objectKey: "test/audio-file.mp3",
        contentHash: "abc123",
        format: "mp3",
        fileSize: 5000000,
      },
    });
  }
}

beforeEach(async () => {
  await createTestData();
});

test("database-quality loader returns health metrics for admin", async () => {
  const cookieHeader = await createAdminSession();
  const request = new Request("http://localhost/admin/database-quality", {
    headers: { cookie: cookieHeader },
  });

  const data = await loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/admin/database-quality",
  });

  expect(data.overallScore).toBeGreaterThanOrEqual(0);
  expect(data.overallScore).toBeLessThanOrEqual(100);
  expect(data.metrics).toBeDefined();
  expect(data.metrics.audio).toBeGreaterThanOrEqual(0);
  expect(data.metrics.covers).toBeGreaterThanOrEqual(0);
  expect(data.metrics.duration).toBeGreaterThanOrEqual(0);
  expect(data.metadataIssues).toBeDefined();
  expect(data.tracksWithMetadataIssues).toBeGreaterThanOrEqual(0);
  expect(data.tracksWithMetadataIssues).toBeLessThanOrEqual(data.totalTracks);
  const affectedPercent = percentOfTracksAffected(data.tracksWithMetadataIssues, data.totalTracks);
  expect(affectedPercent).toBeGreaterThanOrEqual(0);
  expect(affectedPercent).toBeLessThanOrEqual(100);
  expect(data.storageStats).toBeDefined();
  expect(data.storageStats.totalBytes).toBeGreaterThanOrEqual(0);
});

test("database-quality loader requires admin role", async () => {
  const user = await prisma.user.create({
    select: { id: true },
    data: createUser(),
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });

  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  const cookieHeader = `${parsedCookie.name}=${parsedCookie.value}`;

  const request = new Request("http://localhost/admin/database-quality", {
    headers: { cookie: cookieHeader },
  });

  await expect(
    loader({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/admin/database-quality",
    }),
  ).rejects.toThrow();
});

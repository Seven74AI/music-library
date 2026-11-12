/**
 * Unit tests for the database-quality admin page loader.
 */
import { parseString } from "set-cookie-parser";
import { expect, test, beforeEach } from "vitest";
import { percentOfTracksAffected } from "#app/features/admin/database-quality.ts";
import {
  countTracksWithMetadataIssues,
  DATABASE_QUALITY_CACHE_KEY,
  getMetadataIssues,
} from "#app/features/admin/database-quality.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { cache } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { linkGenresToTrack } from "#tests/track-genre-test-utils.ts";
import { loader } from "./database-quality.tsx";

let lastFixtureUniqueId = "";

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
  lastFixtureUniqueId = uniqueId;
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
        duration: 180,
        year: 2020,
        lyrics: "Test lyrics",
      },
      {
        title: "Track With Audio",
        artistId: artist.id,
        serviceId: service.id,
        externalId: `audio-${uniqueId}`,
        duration: 8000,
        year: 2021,
      },
    ],
  });

  const completeTrack = await prisma.track.findFirst({
    where: { externalId: `complete-${uniqueId}` },
  });
  if (completeTrack) {
    await linkGenresToTrack(completeTrack.id, "Rock");
  }

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
  await cache.delete(DATABASE_QUALITY_CACHE_KEY);

  const fixtureSuspicious = await prisma.track.count({
    where: {
      externalId: { in: [`complete-${lastFixtureUniqueId}`, `audio-${lastFixtureUniqueId}`] },
      OR: [{ duration: { lt: 5 } }, { duration: { gt: 7200 } }],
    },
  });
  expect(fixtureSuspicious).toBe(1);

  const fixtureWithAudio = await prisma.track.count({
    where: {
      externalId: `audio-${lastFixtureUniqueId}`,
      audioFiles: { some: {} },
    },
  });
  expect(fixtureWithAudio).toBe(1);

  const totalTracks = await prisma.track.count();
  const tracksWithAudio = await prisma.track.count({ where: { audioFiles: { some: {} } } });
  const tracksWithDuration = await prisma.track.count({ where: { duration: { not: null } } });
  const metadataIssues = await getMetadataIssues();
  const tracksWithMetadataIssues = await countTracksWithMetadataIssues();

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

  expect(data.totalTracks).toBe(totalTracks);
  expect(data.metrics.audio).toBe(totalTracks > 0 ? (tracksWithAudio / totalTracks) * 100 : 0);
  expect(data.metrics.duration).toBe(
    totalTracks > 0 ? (tracksWithDuration / totalTracks) * 100 : 0,
  );
  expect(data.metadataIssues.suspiciousDurations).toBe(metadataIssues.suspiciousDurations);
  expect(metadataIssues.suspiciousDurations).toBeGreaterThanOrEqual(fixtureSuspicious);
  expect(data.tracksWithMetadataIssues).toBe(tracksWithMetadataIssues);
  expect(data.overallScore).toBeGreaterThan(0);

  const affectedPercent = percentOfTracksAffected(data.tracksWithMetadataIssues, data.totalTracks);
  expect(affectedPercent).toBeGreaterThan(0);
  expect(data.storageStats.totalBytes).toBeGreaterThan(0);
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

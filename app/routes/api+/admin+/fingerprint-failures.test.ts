import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./fingerprint-failures.tsx";

async function createAdminCookie() {
  const user = await prisma.user.create({
    select: { id: true },
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
  return `${parsedCookie.name}=${parsedCookie.value}`;
}

async function ensureServices() {
  const local = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const youtube = await prisma.service.upsert({
    where: { name: "youtube" },
    update: {},
    create: {
      name: "youtube",
      displayName: "YouTube",
      baseUrl: "https://www.youtube.com",
      isActive: true,
    },
  });
  return { local, youtube };
}

async function createTrackWithAudio(opts: {
  title: string;
  artistName: string;
  serviceId: string;
  audio: {
    contentHash?: string | null;
    audioFingerprint?: string | null;
    format?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    serviceId?: string | null;
    objectKey?: string;
  };
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const track = await prisma.track.create({
    data: {
      title: opts.title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: opts.serviceId } },
      artist: {
        create: {
          name: opts.artistName,
          normalizedName: opts.artistName.toLowerCase(),
        },
      },
    },
  });

  const audioFile = await prisma.trackAudioFile.create({
    data: {
      trackId: track.id,
      objectKey: opts.audio.objectKey ?? `audio/test/${track.id}.mp3`,
      contentHash: opts.audio.contentHash ?? undefined,
      audioFingerprint: opts.audio.audioFingerprint ?? undefined,
      format: opts.audio.format ?? "mp3",
      mimeType: opts.audio.mimeType ?? "audio/mpeg",
      fileName: opts.audio.fileName ?? `${opts.title}.mp3`,
      fileSize: opts.audio.fileSize ?? 1_000_000,
      serviceId: opts.audio.serviceId === undefined ? opts.serviceId : opts.audio.serviceId,
    },
  });

  return { track, audioFile };
}

function unwrapLoaderData<T>(result: unknown): T {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: T }).data;
  }
  return result as T;
}

function loadApi(cookie: string, search = "") {
  const request = new Request(`http://localhost/api/admin/fingerprint-failures${search}`, {
    headers: { cookie },
  });
  return loader({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/api/admin/fingerprint-failures",
  });
}

describe("fingerprint-failures admin API", () => {
  beforeEach(async () => {
    await prisma.trackAudioFile.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("returns stats and empty failures when library is empty", async () => {
    const cookie = await createAdminCookie();
    const result = unwrapLoaderData<Awaited<ReturnType<typeof loadApi>>["data"]>(
      await loadApi(cookie),
    );

    expect(result.stats).toEqual({
      total: 0,
      withContentHash: 0,
      withAudioFingerprint: 0,
      fingerprintFailed: 0,
      unprocessed: 0,
      healthyPercent: 0,
    });
    expect(result.failures).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.totalFailures).toBe(0);
  });

  test("classifies healthy, failed, and unprocessed audio files in stats", async () => {
    const cookie = await createAdminCookie();
    const { local, youtube } = await ensureServices();

    await createTrackWithAudio({
      title: "Healthy Track",
      artistName: "Artist A",
      serviceId: local.id,
      audio: {
        contentHash: "hash-healthy",
        audioFingerprint: "fp-healthy",
        serviceId: null,
      },
    });
    await createTrackWithAudio({
      title: "Failed Fingerprint",
      artistName: "Artist B",
      serviceId: youtube.id,
      audio: {
        contentHash: "hash-failed",
        audioFingerprint: null,
        format: "mp3",
        fileSize: 2_500_000,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Unprocessed Track",
      artistName: "Artist C",
      serviceId: local.id,
      audio: {
        contentHash: null,
        audioFingerprint: null,
        serviceId: null,
      },
    });

    const result = unwrapLoaderData<{
      stats: {
        total: number;
        withContentHash: number;
        withAudioFingerprint: number;
        fingerprintFailed: number;
        unprocessed: number;
        healthyPercent: number;
      };
      failures: Array<{
        title: string;
        contentHash: string | null;
        audioFingerprint: string | null;
      }>;
      totalFailures: number;
    }>(await loadApi(cookie));

    expect(result.stats.total).toBe(3);
    expect(result.stats.withContentHash).toBe(2);
    expect(result.stats.withAudioFingerprint).toBe(1);
    expect(result.stats.fingerprintFailed).toBe(1);
    expect(result.stats.unprocessed).toBe(1);
    expect(result.stats.healthyPercent).toBe(33); // 1/3 rounded
    expect(result.totalFailures).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.title).toBe("Failed Fingerprint");
    expect(result.failures[0]?.contentHash).toBe("hash-failed");
    expect(result.failures[0]?.audioFingerprint).toBeNull();
  });

  test("failure list includes track and audio file fields", async () => {
    const cookie = await createAdminCookie();
    const { youtube } = await ensureServices();

    const { track, audioFile } = await createTrackWithAudio({
      title: "Corrupt YT Download",
      artistName: "YouTube Artist",
      serviceId: youtube.id,
      audio: {
        contentHash: "hash-corrupt",
        audioFingerprint: null,
        format: "mp3",
        mimeType: "audio/mpeg",
        fileName: "corrupt.mp3",
        fileSize: 512_000,
        objectKey: "audio/tracks/youtube/corrupt.mp3",
        serviceId: youtube.id,
      },
    });

    const result = unwrapLoaderData<{
      failures: Array<{
        id: string;
        trackId: string;
        title: string;
        artist: string;
        objectKey: string;
        fileName: string | null;
        format: string | null;
        mimeType: string | null;
        fileSize: number | null;
        uploadedAt: string;
        serviceId: string | null;
        serviceName: string | null;
        contentHash: string | null;
      }>;
    }>(await loadApi(cookie));

    expect(result.failures).toHaveLength(1);
    const row = result.failures[0]!;
    expect(row.id).toBe(audioFile.id);
    expect(row.trackId).toBe(track.id);
    expect(row.title).toBe("Corrupt YT Download");
    expect(row.artist).toBe("YouTube Artist");
    expect(row.objectKey).toBe("audio/tracks/youtube/corrupt.mp3");
    expect(row.fileName).toBe("corrupt.mp3");
    expect(row.format).toBe("mp3");
    expect(row.mimeType).toBe("audio/mpeg");
    expect(row.fileSize).toBe(512_000);
    expect(row.serviceId).toBe(youtube.id);
    expect(row.serviceName).toBe("youtube");
    expect(row.contentHash).toBe("hash-corrupt");
    expect(typeof row.uploadedAt).toBe("string");
  });

  test("filters failures by format and service", async () => {
    const cookie = await createAdminCookie();
    const { local, youtube } = await ensureServices();

    await createTrackWithAudio({
      title: "YT MP3 Fail",
      artistName: "A",
      serviceId: youtube.id,
      audio: {
        contentHash: "h1",
        audioFingerprint: null,
        format: "mp3",
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Local FLAC Fail",
      artistName: "B",
      serviceId: local.id,
      audio: {
        contentHash: "h2",
        audioFingerprint: null,
        format: "flac",
        serviceId: null,
      },
    });
    await createTrackWithAudio({
      title: "YT WAV Fail",
      artistName: "C",
      serviceId: youtube.id,
      audio: {
        contentHash: "h3",
        audioFingerprint: null,
        format: "wav",
        serviceId: youtube.id,
      },
    });

    const byFormat = unwrapLoaderData<{
      failures: Array<{ title: string }>;
      totalFailures: number;
      filters: { format: string; service: string; size: string };
    }>(await loadApi(cookie, "?format=mp3"));

    expect(byFormat.totalFailures).toBe(1);
    expect(byFormat.failures.map((f) => f.title)).toEqual(["YT MP3 Fail"]);
    expect(byFormat.filters.format).toBe("mp3");

    const byLocal = unwrapLoaderData<{
      failures: Array<{ title: string }>;
      totalFailures: number;
    }>(await loadApi(cookie, "?service=local"));

    expect(byLocal.totalFailures).toBe(1);
    expect(byLocal.failures.map((f) => f.title)).toEqual(["Local FLAC Fail"]);

    const byYoutube = unwrapLoaderData<{
      failures: Array<{ title: string }>;
      totalFailures: number;
    }>(await loadApi(cookie, "?service=youtube"));

    expect(byYoutube.totalFailures).toBe(2);
    expect(byYoutube.failures.map((f) => f.title).sort()).toEqual(["YT MP3 Fail", "YT WAV Fail"]);
  });

  test("service=local includes failures that belong to the local service", async () => {
    const cookie = await createAdminCookie();
    const { local, youtube } = await ensureServices();

    await createTrackWithAudio({
      title: "Seeded Local Fail",
      artistName: "Local Artist",
      serviceId: local.id,
      audio: {
        contentHash: "hash-local-service",
        audioFingerprint: null,
        format: "flac",
        serviceId: local.id,
      },
    });
    await createTrackWithAudio({
      title: "YouTube Fail",
      artistName: "YouTube Artist",
      serviceId: youtube.id,
      audio: {
        contentHash: "hash-youtube",
        audioFingerprint: null,
        format: "mp3",
        serviceId: youtube.id,
      },
    });

    const byLocal = unwrapLoaderData<{
      failures: Array<{ title: string; serviceId: string | null; serviceName: string | null }>;
      totalFailures: number;
    }>(await loadApi(cookie, "?service=local"));

    expect(byLocal.totalFailures).toBe(1);
    expect(byLocal.failures.map((f) => f.title)).toEqual(["Seeded Local Fail"]);
    expect(byLocal.failures[0]?.serviceId).toBe(local.id);
    expect(byLocal.failures[0]?.serviceName).toBe("local");
  });

  test("filters failures by file size bucket", async () => {
    const cookie = await createAdminCookie();
    const { youtube } = await ensureServices();

    await createTrackWithAudio({
      title: "Small Fail",
      artistName: "A",
      serviceId: youtube.id,
      audio: { contentHash: "s", audioFingerprint: null, fileSize: 500_000, serviceId: youtube.id },
    });
    await createTrackWithAudio({
      title: "Medium Fail",
      artistName: "B",
      serviceId: youtube.id,
      audio: {
        contentHash: "m",
        audioFingerprint: null,
        fileSize: 3_000_000,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Large Fail",
      artistName: "C",
      serviceId: youtube.id,
      audio: {
        contentHash: "l",
        audioFingerprint: null,
        fileSize: 15_000_000,
        serviceId: youtube.id,
      },
    });

    const small = unwrapLoaderData<{ failures: Array<{ title: string }>; totalFailures: number }>(
      await loadApi(cookie, "?size=small"),
    );
    expect(small.totalFailures).toBe(1);
    expect(small.failures[0]?.title).toBe("Small Fail");

    const medium = unwrapLoaderData<{ failures: Array<{ title: string }>; totalFailures: number }>(
      await loadApi(cookie, "?size=medium"),
    );
    expect(medium.totalFailures).toBe(1);
    expect(medium.failures[0]?.title).toBe("Medium Fail");

    const large = unwrapLoaderData<{ failures: Array<{ title: string }>; totalFailures: number }>(
      await loadApi(cookie, "?size=large"),
    );
    expect(large.totalFailures).toBe(1);
    expect(large.failures[0]?.title).toBe("Large Fail");
  });

  test("file size buckets follow the displayed megabyte boundaries", async () => {
    const cookie = await createAdminCookie();
    const { youtube } = await ensureServices();
    const mb = 1024 * 1024;

    await createTrackWithAudio({
      title: "Just under 1 MB",
      artistName: "A",
      serviceId: youtube.id,
      audio: {
        contentHash: "under-1mb",
        audioFingerprint: null,
        fileSize: mb - 1,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Decimal megabyte",
      artistName: "B",
      serviceId: youtube.id,
      audio: {
        contentHash: "decimal-1mb",
        audioFingerprint: null,
        fileSize: 1_000_000,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "One mebibyte",
      artistName: "C",
      serviceId: youtube.id,
      audio: {
        contentHash: "one-mebibyte",
        audioFingerprint: null,
        fileSize: mb,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Decimal ten megabytes",
      artistName: "D",
      serviceId: youtube.id,
      audio: {
        contentHash: "decimal-10mb",
        audioFingerprint: null,
        fileSize: 10_000_000,
        serviceId: youtube.id,
      },
    });
    await createTrackWithAudio({
      title: "Ten mebibytes",
      artistName: "E",
      serviceId: youtube.id,
      audio: {
        contentHash: "ten-mebibytes",
        audioFingerprint: null,
        fileSize: 10 * mb,
        serviceId: youtube.id,
      },
    });

    const titles = async (size: string) => {
      const result = unwrapLoaderData<{ failures: Array<{ title: string }> }>(
        await loadApi(cookie, `?size=${size}`),
      );
      return result.failures.map((row) => row.title).sort();
    };

    expect(await titles("small")).toEqual(["Decimal megabyte", "Just under 1 MB"]);
    expect(await titles("medium")).toEqual(["Decimal ten megabytes", "One mebibyte"]);
    expect(await titles("large")).toEqual(["Ten mebibytes"]);
  });

  test("paginates failure results", async () => {
    const cookie = await createAdminCookie();
    const { youtube } = await ensureServices();

    for (let i = 0; i < 3; i++) {
      await createTrackWithAudio({
        title: `Fail ${i}`,
        artistName: `Artist ${i}`,
        serviceId: youtube.id,
        audio: {
          contentHash: `hash-${i}`,
          audioFingerprint: null,
          serviceId: youtube.id,
        },
      });
    }

    const page1 = unwrapLoaderData<{
      failures: Array<{ title: string }>;
      page: number;
      totalPages: number;
      totalFailures: number;
      pageSize: number;
    }>(await loadApi(cookie, "?page=1&pageSize=2"));

    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    expect(page1.totalFailures).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.failures).toHaveLength(2);

    const page2 = unwrapLoaderData<{
      failures: Array<{ title: string }>;
      page: number;
      totalPages: number;
    }>(await loadApi(cookie, "?page=2&pageSize=2"));

    expect(page2.page).toBe(2);
    expect(page2.failures).toHaveLength(1);
  });

  test("rejects non-admin users", async () => {
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
    const cookie = `${parsedCookie.name}=${parsedCookie.value}`;

    await expect(loadApi(cookie)).rejects.toThrow();
  });
});

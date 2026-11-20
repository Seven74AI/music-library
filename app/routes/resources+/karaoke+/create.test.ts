import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  getSessionExpirationDate,
  sessionKey,
} from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";
import { action } from "./create.tsx";

beforeEach(() => {
  process.env.KARAOKE_GENERATION_MOCKS = "true";
  process.env.KARAOKE_GENERATION_ENABLED = "true";
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.KARAOKE_GENERATION_ENABLED;
  delete process.env.KARAOKE_GENERATION_MOCKS;
});

async function createCookie() {
  const user = await prisma.user.create({
    select: { id: true },
    data: createUser(),
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: { expirationDate: getSessionExpirationDate(), userId: user.id },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(
    await authSessionStorage.commitSession(authSession),
  )!;
  return {
    cookie: new URLSearchParams({ [parsed.name]: parsed.value }).toString(),
    user,
  };
}

function call(cookie: string | null, fields: Record<string, string>) {
  return action({
    request: new Request("http://localhost/resources/karaoke/create", {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as never);
}

async function unwrap(result: unknown) {
  const r = result as { data?: any; init?: { status?: number } } | Response;
  if (r instanceof Response)
    return { status: r.status, body: (await r.json()) as any };
  return { status: r.init?.status ?? 200, body: r.data as any };
}

describe("create karaoke action", () => {
  test("requires authentication", async () => {
    const track = await createTrack("T");
    await expect(
      call(null, {
        trackId: track.id,
        language: "en",
        textSource: "paste",
        text: "hi",
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Response && (e.status === 302 || e.status === 401),
    );
  });

  test("creates TrackKaraoke once, a draft version and a dispatched job", async () => {
    const { cookie, user } = await createCookie();
    const track = await createTrack("T");
    const a = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "en",
        textSource: "paste",
        text: "hello world",
      }),
    );
    const b = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "fr",
        textSource: "paste",
        text: "salut",
      }),
    );
    expect(a.status).toBe(200);
    expect(a.body.versionId).toBeTruthy();
    expect(b.body.versionId).not.toBe(a.body.versionId);

    expect(
      await prisma.trackKaraoke.count({ where: { trackId: track.id } }),
    ).toBe(1);
    const version = await prisma.trackKaraokeVersion.findUnique({
      where: { id: a.body.versionId },
      include: { generationJob: true },
    });
    expect(version).toMatchObject({
      status: "draft",
      language: "en",
      source: "paste",
      lyricsText: "hello world",
      lines: "[]",
      createdBy: user.id,
    });
    expect(version?.generationJob).toMatchObject({ status: "dispatched" });
    expect(version?.generationJob?.providerJobId).toBeTruthy();
  });

  test("whisper source needs no text", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const { status, body } = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "en",
        textSource: "whisper",
      }),
    );
    expect(status).toBe(200);
    const v = await prisma.trackKaraokeVersion.findUnique({
      where: { id: body.versionId },
    });
    expect(v).toMatchObject({ source: "whisper", lyricsText: "" });
  });

  test("returns 503 and creates nothing when generation is disabled", async () => {
    process.env.KARAOKE_GENERATION_ENABLED = "false";
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const { status } = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "en",
        textSource: "paste",
        text: "x",
      }),
    );
    expect(status).toBe(503);
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(0);
  });

  async function makeVideo(trackId: string) {
    const service = await prisma.service.findFirstOrThrow({
      where: { name: "local" },
    });
    return prisma.trackVideoFile.create({
      data: { trackId, serviceId: service.id, objectKey: `video/${trackId}.mp4` },
    });
  }

  test("rejects a nonexistent or foreign videoFileId with 400", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const other = await createTrack("Other");
    const foreign = await makeVideo(other.id);
    for (const videoFileId of ["does-not-exist", foreign.id]) {
      const { status } = await unwrap(
        await call(cookie, {
          trackId: track.id,
          language: "en",
          textSource: "paste",
          text: "x",
          videoFileId,
        }),
      );
      expect(status).toBe(400);
    }
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(0);
  });

  test("accepts the track's own videoFileId", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const video = await makeVideo(track.id);
    const { status, body } = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "en",
        textSource: "paste",
        text: "x",
        videoFileId: video.id,
      }),
    );
    expect(status).toBe(200);
    expect(
      (
        await prisma.trackKaraokeVersion.findUnique({
          where: { id: body.versionId },
        })
      )?.videoFileId,
    ).toBe(video.id);
  });

  test("concurrent creates for the same track all succeed with one TrackKaraoke", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call(cookie, {
          trackId: track.id,
          language: "en",
          textSource: "paste",
          text: `v${i}`,
        }).then(unwrap),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(
      await prisma.trackKaraoke.count({ where: { trackId: track.id } }),
    ).toBe(1);
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(5);
  });

  test("fails the job immediately (and still returns the version) on a config error", async () => {
    delete process.env.KARAOKE_GENERATION_MOCKS;
    vi.stubEnv("MOCKS", "false");
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const { status, body } = await unwrap(
      await call(cookie, {
        trackId: track.id,
        language: "en",
        textSource: "paste",
        text: "x",
      }),
    );
    expect(status).toBe(200);
    const job = await prisma.karaokeGenerationJob.findUnique({
      where: { versionId: body.versionId },
    });
    expect(job?.status).toBe("failed");
    expect(job?.retryCount).toBe(1);
    expect(job?.errorHistory).toContain("not configured");
  });

  test.each([
    [{ language: "de", textSource: "paste", text: "x" }],
    [{ language: "en", textSource: "bogus", text: "x" }],
    [{ language: "en", textSource: "paste" }],
    [{ language: "en", textSource: "track-lyrics", text: "  " }],
  ])("rejects invalid input %#", async (fields) => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const { status } = await unwrap(
      await call(cookie, { trackId: track.id, ...fields }),
    );
    expect(status).toBe(400);
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(0);
  });
});

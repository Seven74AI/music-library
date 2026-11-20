import { existsSync } from "node:fs";
import { parseString } from "set-cookie-parser";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";

const mocks = vi.hoisted(() => ({ fetchYoutubeVideo: vi.fn(), ingest: vi.fn() }));
vi.mock("#app/features/track-video/youtube-video.server.ts", () => ({
  fetchYoutubeVideo: mocks.fetchYoutubeVideo,
}));
vi.mock("#app/features/track-video/ingest-video.server.ts", async (orig) => ({
  ...(await orig<typeof import("#app/features/track-video/ingest-video.server.ts")>()),
  ingestTrackVideoFromPath: mocks.ingest,
}));

import { action } from "./attach-youtube.tsx";

beforeEach(() => {
  mocks.fetchYoutubeVideo.mockReset();
  mocks.ingest.mockReset();
});

async function createCookie() {
  const user = await prisma.user.create({ select: { id: true }, data: createUser() });
  const session = await prisma.session.create({
    select: { id: true },
    data: { expirationDate: getSessionExpirationDate(), userId: user.id },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
  return new URLSearchParams({ [parsed.name]: parsed.value }).toString();
}

function call(cookie: string | null, fields: Record<string, string>) {
  return action({
    request: new Request("http://localhost/resources/karaoke/attach-youtube", {
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
  if (r instanceof Response) return { status: r.status, body: (await r.json()) as any };
  return { status: r.init?.status ?? 200, body: r.data as any };
}

const GOOD_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("attach-youtube", () => {
  test("requires auth", async () => {
    const track = await createTrack("T");
    const res = await call(null, { trackId: track.id, url: GOOD_URL }).catch((e) => e);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect(mocks.fetchYoutubeVideo).not.toHaveBeenCalled();
  });

  test.each([
    "http://169.254.169.254/latest",
    "https://evil.com/watch?v=abc",
    "https://youtube.com.evil.com/watch?v=abc",
    "--exec=foo",
  ])("rejects unsafe url %s", async (url) => {
    const cookie = await createCookie();
    const track = await createTrack("T");
    const { status, body } = await unwrap(await call(cookie, { trackId: track.id, url }));
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mocks.fetchYoutubeVideo).not.toHaveBeenCalled();
  });

  test("404 for unknown track", async () => {
    const cookie = await createCookie();
    const { status } = await unwrap(await call(cookie, { trackId: "nope", url: GOOD_URL }));
    expect(status).toBe(404);
  });

  test("fetches, ingests, returns video file id, cleans temp dir", async () => {
    const cookie = await createCookie();
    const track = await createTrack("T");
    let outputDir = "";
    mocks.fetchYoutubeVideo.mockImplementation(async (_url: string, opts: { outputDir: string }) => {
      outputDir = opts.outputDir;
      return { ok: true, filePath: `${opts.outputDir}/abc.mp4` };
    });
    mocks.ingest.mockResolvedValue({
      videoFile: { id: "vf1", trackId: track.id, format: "mp4", fileSize: 10 },
      transcoded: false,
    });
    const { status, body } = await unwrap(
      await call(cookie, { trackId: track.id, url: GOOD_URL }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, videoFile: { id: "vf1" } });
    expect(mocks.fetchYoutubeVideo).toHaveBeenCalledWith(
      GOOD_URL,
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ trackId: track.id, inputPath: `${outputDir}/abc.mp4` }),
    );
    expect(existsSync(outputDir)).toBe(false);
  });

  test("fetch failure returns 502 suggesting upload", async () => {
    const cookie = await createCookie();
    const track = await createTrack("T");
    mocks.fetchYoutubeVideo.mockResolvedValue({ ok: false, error: "bot wall" });
    const { status, body } = await unwrap(
      await call(cookie, { trackId: track.id, url: GOOD_URL }),
    );
    expect(status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/upload/i);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});

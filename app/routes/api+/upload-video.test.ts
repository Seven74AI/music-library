import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseString } from "set-cookie-parser";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { isTranscodeCompliant, probeVideo } from "#app/features/track-video/transcode.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action } from "./upload-video.tsx";

let dir: string;
let compliantMp4: Buffer;
let webm: Buffer;

function ffmpegMake(name: string, codecArgs: string[]) {
  const out = join(dir, name);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=1:size=160x120:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      ...codecArgs,
      out,
    ],
    { stdio: "ignore" },
  );
  expect(r.status).toBe(0);
  return readFileSync(out);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "upload-video-test-"));
  compliantMp4 = ffmpegMake("ok.mp4", [
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
  ]);
  webm = ffmpegMake("src.webm", ["-c:v", "libvpx", "-c:a", "libvorbis"]);
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.VIDEO_UPLOAD_MAX_BYTES;
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

async function createTrack() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "" },
  });
  return prisma.track.create({
    data: {
      title: "Video Track",
      externalId: `upv-${suffix}`,
      service: { connect: { id: service.id } },
      artist: { create: { name: `Artist-${suffix}`, normalizedName: `artist-${suffix}` } },
    },
  });
}

function call(cookie: string | null, form: FormData) {
  return action({
    request: new Request("http://localhost/api/upload-video", {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: form,
    }),
    params: {},
    context: {},
  } as never);
}

function formFor(trackId: string, bytes: Buffer, name: string, type: string) {
  const form = new FormData();
  form.append("trackId", trackId);
  form.append("videoFile", new File([new Uint8Array(bytes)], name, { type }));
  return form;
}

async function unwrap(result: unknown) {
  const r = result as { data?: unknown; init?: { status?: number } } | Response;
  if (r instanceof Response) return { status: r.status, body: await r.json() };
  return { status: r.init?.status ?? 200, body: r.data };
}

describe("upload-video action", () => {
  test("requires authentication", async () => {
    const track = await createTrack();
    await expect(
      call(null, formFor(track.id, compliantMp4, "a.mp4", "video/mp4")),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Response && (e.status === 302 || e.status === 401),
    );
  });

  test("accepts a compliant MP4 without transcoding", async () => {
    const cookie = await createCookie();
    const track = await createTrack();
    const { status, body } = await unwrap(
      await call(cookie, formFor(track.id, compliantMp4, "clip.mp4", "video/mp4")),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, transcoded: false });

    const row = await prisma.trackVideoFile.findUnique({ where: { trackId: track.id } });
    expect(row).toMatchObject({ mimeType: "video/mp4", format: "mp4", fileName: "clip.mp4" });
    expect(row?.objectKey).toMatch(/^video\/tracks\/local\/.+\.mp4$/);
    expect(row?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.fileSize).toBe(compliantMp4.length);
  }, 60_000);

  test("transcodes a non-compliant source to H.264/AAC MP4", async () => {
    const cookie = await createCookie();
    const track = await createTrack();
    const { status, body } = await unwrap(
      await call(cookie, formFor(track.id, webm, "clip.webm", "video/webm")),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, transcoded: true });

    const row = await prisma.trackVideoFile.findUnique({ where: { trackId: track.id } });
    expect(row).toMatchObject({ mimeType: "video/mp4", format: "mp4" });
    expect(row?.objectKey.endsWith(".mp4")).toBe(true);
    expect(row?.fileSize).toBeGreaterThan(0);
  }, 90_000);

  test("rejects a file above the size cap with 413 and stores nothing", async () => {
    process.env.VIDEO_UPLOAD_MAX_BYTES = "1000";
    const cookie = await createCookie();
    const track = await createTrack();
    const { status } = await unwrap(
      await call(cookie, formFor(track.id, compliantMp4, "big.mp4", "video/mp4")),
    );
    expect(status).toBe(413);
    expect(await prisma.trackVideoFile.count({ where: { trackId: track.id } })).toBe(0);
  }, 60_000);

  test("rejects non-video content with 400", async () => {
    const cookie = await createCookie();
    const track = await createTrack();
    const { status } = await unwrap(
      await call(
        cookie,
        formFor(track.id, Buffer.from("not a video at all"), "x.mp4", "video/mp4"),
      ),
    );
    expect(status).toBe(400);
    expect(await prisma.trackVideoFile.count({ where: { trackId: track.id } })).toBe(0);
  }, 60_000);

  test("returns 404 for an unknown track", async () => {
    const cookie = await createCookie();
    const { status } = await unwrap(
      await call(cookie, formFor("does-not-exist", compliantMp4, "a.mp4", "video/mp4")),
    );
    expect(status).toBe(404);
  });

  test("probe helper agrees the stored fixture is compliant", async () => {
    const out = join(dir, "ok.mp4");
    expect(isTranscodeCompliant(await probeVideo(out))).toBe(true);
  });
});

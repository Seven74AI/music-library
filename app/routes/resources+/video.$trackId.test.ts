import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseString } from "set-cookie-parser";
import { afterAll, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./video.$trackId.tsx";

const fixtureDirs = new Set<string>();
afterAll(() => {
  for (const d of fixtureDirs) rmSync(d, { recursive: true, force: true });
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

const BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

async function setup(withFile = true) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "" },
  });
  const track = await prisma.track.create({
    data: {
      title: "V",
      externalId: `sv-${suffix}`,
      service: { connect: { id: service.id } },
      artist: { create: { name: `A-${suffix}`, normalizedName: `a-${suffix}` } },
    },
  });
  const objectKey = `video/tracks/local/${track.id}.mp4`;
  if (withFile) {
    await prisma.trackVideoFile.create({
      data: { trackId: track.id, serviceId: service.id, objectKey, mimeType: "video/mp4" },
    });
    const path = join(process.cwd(), "tests", "fixtures", "uploaded", objectKey);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, BYTES);
    fixtureDirs.add(path);
  }
  return track;
}

function call(cookie: string | null, trackId: string, range?: string) {
  return loader({
    request: new Request(`http://localhost/resources/video/${trackId}`, {
      headers: { ...(cookie ? { cookie } : {}), ...(range ? { Range: range } : {}) },
    }),
    params: { trackId },
    context: {},
    url: new URL(`http://localhost/resources/video/${trackId}`),
  } as never) as Promise<Response>;
}

describe("video serve route", () => {
  test("requires authentication", async () => {
    const track = await setup();
    await expect(call(null, track.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof Response && (e.status === 302 || e.status === 401),
    );
  });

  test("full request returns 200 with Accept-Ranges", async () => {
    const cookie = await createCookie();
    const track = await setup();
    const res = await call(cookie, track.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });

  test("Range request returns 206 with the slice and Content-Range", async () => {
    const cookie = await createCookie();
    const track = await setup();
    const res = await call(cookie, track.id, "bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES.subarray(10, 20));
  });

  test("out-of-range request returns 416", async () => {
    const cookie = await createCookie();
    const track = await setup();
    const res = await call(cookie, track.id, "bytes=500-600");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */100");
  });

  test("404 when the track has no video", async () => {
    const cookie = await createCookie();
    const track = await setup(false);
    await expect(call(cookie, track.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof Response && e.status === 404,
    );
  });
});

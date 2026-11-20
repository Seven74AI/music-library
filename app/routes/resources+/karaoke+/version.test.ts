import { parseString } from "set-cookie-parser";
import { expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";
import { loader } from "./version.tsx";

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

function get(query: string, cookie: string | null) {
  return loader({
    request: new Request(`http://localhost/resources/karaoke/version?${query}`, {
      headers: cookie ? { cookie } : {},
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

const LINES = [[{ word: "hi", start: 1, end: 2 }], []];

async function seed(trackId: string) {
  return prisma.trackKaraokeVersion.create({
    data: {
      trackId,
      language: "en",
      source: "paste",
      lyricsText: "hi",
      lines: JSON.stringify(LINES),
      status: "draft",
      generationJob: { create: { status: "completed" } },
    },
  });
}

test("returns one version's full lines + job status", async () => {
  const cookie = await createCookie();
  const track = await createTrack("T");
  const v = await seed(track.id);
  const { status, body } = await unwrap(
    await get(`trackId=${track.id}&versionId=${v.id}`, cookie),
  );
  expect(status).toBe(200);
  expect(body.version).toMatchObject({
    id: v.id,
    lyricsText: "hi",
    lines: LINES,
    jobStatus: "completed",
    language: "en",
    source: "paste",
  });
});

test("404 when the version belongs to another track", async () => {
  const cookie = await createCookie();
  const a = await createTrack("A");
  const b = await createTrack("B");
  const v = await seed(a.id);
  const { status, body } = await unwrap(
    await get(`trackId=${b.id}&versionId=${v.id}`, cookie),
  );
  expect(status).toBe(404);
  expect(body.success).toBe(false);
});

test("400 without params; unauthenticated is rejected", async () => {
  const cookie = await createCookie();
  expect((await unwrap(await get("trackId=x", cookie))).status).toBe(400);
  await expect(get("trackId=x&versionId=y", null)).rejects.toBeDefined();
});

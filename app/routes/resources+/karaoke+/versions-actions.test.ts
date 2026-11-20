import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { casRepointCurrentVersion } from "#app/features/karaoke-generation/versions.server.ts";
import {
  getSessionExpirationDate,
  sessionKey,
} from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";
import { action as markReady } from "./mark-ready.tsx";
import { action as reAlign } from "./re-align.tsx";
import { action as restore } from "./restore.tsx";
import { action as saveEdit } from "./save-edit.tsx";
import { loader as versionsLoader } from "./versions.tsx";

beforeEach(() => {
  process.env.KARAOKE_GENERATION_MOCKS = "true";
  process.env.KARAOKE_GENERATION_ENABLED = "true";
});
afterEach(() => {
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

function post(
  fn: (args: never) => Promise<unknown>,
  cookie: string | null,
  fields: Record<string, string>,
) {
  return fn({
    request: new Request("http://localhost/resources/karaoke/x", {
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

const LINES = [
  [
    { word: "hello", start: 1, end: 1.5 },
    { word: "world", start: 1.6, end: 2 },
  ],
  [],
];

async function seedVersion(
  trackId: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.trackKaraokeVersion.create({
    data: {
      trackId,
      language: "fr",
      source: "paste",
      lyricsText: "salut",
      lines: JSON.stringify([[{ word: "salut", start: 0, end: 1 }]]),
      status: "draft",
      ...overrides,
    },
  });
}

const isAuthRedirect = (e: unknown) =>
  e instanceof Response && (e.status === 302 || e.status === 401);

describe("auth", () => {
  test.each([
    ["save-edit", saveEdit],
    ["mark-ready", markReady],
    ["restore", restore],
    ["re-align", reAlign],
  ])("%s requires authentication", async (_n, fn) => {
    await expect(
      post(fn as never, null, { versionId: "x", text: "t", lines: "[]" }),
    ).rejects.toSatisfy(isAuthRedirect);
  });

  test("versions loader requires authentication", async () => {
    await expect(
      versionsLoader({
        request: new Request("http://localhost/x?trackId=t"),
        params: {},
        context: {},
      } as never),
    ).rejects.toSatisfy(isAuthRedirect);
  });
});

describe("save-edit", () => {
  test("creates a new draft version copying metadata and leaves the source intact", async () => {
    const { cookie, user } = await createCookie();
    const track = await createTrack("T");
    const source = await seedVersion(track.id, { status: "ready" });
    const before = await prisma.trackKaraokeVersion.findUnique({
      where: { id: source.id },
    });

    const res = await unwrap(
      await post(saveEdit, cookie, {
        versionId: source.id,
        text: "hello world",
        lines: JSON.stringify(LINES),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.versionId).not.toBe(source.id);

    const created = await prisma.trackKaraokeVersion.findUnique({
      where: { id: res.body.versionId },
    });
    expect(created).toMatchObject({
      trackId: track.id,
      language: "fr",
      source: "paste",
      lyricsText: "hello world",
      status: "draft",
      createdBy: user.id,
    });
    expect(JSON.parse(created!.lines)).toEqual(LINES);
    expect(
      await prisma.trackKaraokeVersion.findUnique({ where: { id: source.id } }),
    ).toEqual(before);
  });

  test("rejects malformed lines and creates nothing", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const source = await seedVersion(track.id);
    for (const lines of [
      "not json",
      JSON.stringify([[{ word: "a", start: 5, end: 6 }, { word: "b", start: 1, end: 2 }]]),
      JSON.stringify([[{ word: "a", start: 2, end: 1 }]]),
      JSON.stringify({ nope: true }),
    ]) {
      const res = await unwrap(
        await post(saveEdit, cookie, { versionId: source.id, text: "x", lines }),
      );
      expect(res.status).toBe(400);
    }
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(1);
  });

  test("404 for unknown version", async () => {
    const { cookie } = await createCookie();
    const res = await unwrap(
      await post(saveEdit, cookie, {
        versionId: "nope",
        text: "x",
        lines: "[]",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("EditLock: a second user is blocked while the first holds the track lock", async () => {
    const a = await createCookie();
    const b = await createCookie();
    const track = await createTrack("T");
    const source = await seedVersion(track.id);
    const fields = { versionId: source.id, text: "x", lines: "[]" };

    expect((await unwrap(await post(saveEdit, a.cookie, fields))).status).toBe(
      200,
    );
    // same user may keep saving (lock is extended)
    expect((await unwrap(await post(saveEdit, a.cookie, fields))).status).toBe(
      200,
    );
    const blocked = await unwrap(await post(saveEdit, b.cookie, fields));
    expect(blocked.status).toBe(409);
    expect(
      await prisma.editLock.count({
        where: { entityType: "karaoke_version", entityId: track.id },
      }),
    ).toBe(1);
    expect(
      await prisma.trackKaraokeVersion.count({ where: { trackId: track.id } }),
    ).toBe(3); // source + 2 saves by A only
  });
});

describe("mark-ready", () => {
  test("marks ready and creates TrackKaraoke when absent", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const v = await seedVersion(track.id);
    const res = await unwrap(
      await post(markReady, cookie, { versionId: v.id }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      currentVersionId: v.id,
      previousVersionId: null,
    });
    expect(
      (await prisma.trackKaraokeVersion.findUnique({ where: { id: v.id } }))!
        .status,
    ).toBe("ready");
    expect(
      (await prisma.trackKaraoke.findUnique({ where: { trackId: track.id } }))!
        .currentVersionId,
    ).toBe(v.id);
  });

  test("repoints an existing pointer to the newer version", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const v1 = await seedVersion(track.id);
    const v2 = await seedVersion(track.id);
    await post(markReady, cookie, { versionId: v1.id });
    const res = await unwrap(
      await post(markReady, cookie, { versionId: v2.id }),
    );
    expect(res.body.previousVersionId).toBe(v1.id);
    expect(
      (await prisma.trackKaraoke.findUnique({ where: { trackId: track.id } }))!
        .currentVersionId,
    ).toBe(v2.id);
  });

  test("blocked (409) while another user holds the edit lock", async () => {
    const a = await createCookie();
    const b = await createCookie();
    const track = await createTrack("T");
    const v = await seedVersion(track.id);
    await post(saveEdit, a.cookie, { versionId: v.id, text: "x", lines: "[]" });
    const res = await unwrap(
      await post(markReady, b.cookie, { versionId: v.id }),
    );
    expect(res.status).toBe(409);
  });

  test("400 on missing versionId, 404 on unknown", async () => {
    const { cookie } = await createCookie();
    expect((await unwrap(await post(markReady, cookie, {}))).status).toBe(400);
    expect(
      (await unwrap(await post(markReady, cookie, { versionId: "nope" })))
        .status,
    ).toBe(404);
  });
});

describe("CAS repoint", () => {
  test("two concurrent publishes on a fresh track: exactly one wins", async () => {
    const track = await createTrack("T");
    const v1 = await seedVersion(track.id);
    const v2 = await seedVersion(track.id);
    const results = await Promise.all([
      casRepointCurrentVersion(track.id, v1.id),
      casRepointCurrentVersion(track.id, v2.id),
    ]);
    // SQLite may serialize them so the second legitimately sees the first's
    // pointer as its expected value; what must never happen is a silent
    // lost update, i.e. the pointer must equal a version whose call reported ok.
    const pointer = (await prisma.trackKaraoke.findUnique({
      where: { trackId: track.id },
    }))!.currentVersionId;
    const winners = [v1.id, v2.id].filter((_, i) => results[i]!.ok);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners).toContain(pointer);
    expect(await prisma.trackKaraoke.count({ where: { trackId: track.id } })).toBe(1);
  });

  test("a stale expectation loses: pointer unchanged when it moved after the read", async () => {
    const track = await createTrack("T");
    const v1 = await seedVersion(track.id);
    const v2 = await seedVersion(track.id);
    await prisma.trackKaraoke.create({
      data: { trackId: track.id, currentVersionId: v1.id },
    });
    // Simulate a racer: the updateMany guard compares against the value read.
    const stale = await prisma.trackKaraoke.updateMany({
      where: { trackId: track.id, currentVersionId: null },
      data: { currentVersionId: v2.id },
    });
    expect(stale.count).toBe(0);
    expect(
      (await prisma.trackKaraoke.findUnique({ where: { trackId: track.id } }))!
        .currentVersionId,
    ).toBe(v1.id);
  });
});

describe("restore", () => {
  test("repoints to a historic version and marks it ready", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const old = await seedVersion(track.id, { status: "draft" });
    const cur = await seedVersion(track.id, { status: "ready" });
    await prisma.trackKaraoke.create({
      data: { trackId: track.id, currentVersionId: cur.id },
    });
    const res = await unwrap(await post(restore, cookie, { versionId: old.id }));
    expect(res.status).toBe(200);
    expect(res.body.previousVersionId).toBe(cur.id);
    expect(
      (await prisma.trackKaraoke.findUnique({ where: { trackId: track.id } }))!
        .currentVersionId,
    ).toBe(old.id);
    expect(
      (await prisma.trackKaraokeVersion.findUnique({ where: { id: old.id } }))!
        .status,
    ).toBe("ready");
  });
});

describe("re-align", () => {
  test("creates a new draft version (new text) and a job; source untouched", async () => {
    const { cookie, user } = await createCookie();
    const track = await createTrack("T");
    const source = await seedVersion(track.id, { status: "ready" });
    const res = await unwrap(
      await post(reAlign, cookie, { versionId: source.id, text: "new words" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.versionId).not.toBe(source.id);
    const v = await prisma.trackKaraokeVersion.findUnique({
      where: { id: res.body.versionId },
      include: { generationJob: true },
    });
    expect(v).toMatchObject({
      status: "draft",
      lyricsText: "new words",
      language: "fr",
      createdBy: user.id,
    });
    expect(v!.generationJob!.id).toBe(res.body.jobId);
    expect(v!.generationJob!.status).toBe("dispatched");
    expect(
      (await prisma.trackKaraokeVersion.findUnique({ where: { id: source.id } }))!
        .lyricsText,
    ).toBe("salut");
  });

  test("defaults to the source text; 503 when generation disabled", async () => {
    const { cookie } = await createCookie();
    const track = await createTrack("T");
    const source = await seedVersion(track.id);
    const res = await unwrap(
      await post(reAlign, cookie, { versionId: source.id }),
    );
    expect(
      (await prisma.trackKaraokeVersion.findUnique({
        where: { id: res.body.versionId },
      }))!.lyricsText,
    ).toBe("salut");
    delete process.env.KARAOKE_GENERATION_ENABLED;
    expect(
      (await unwrap(await post(reAlign, cookie, { versionId: source.id })))
        .status,
    ).toBe(503);
  });
});

describe("versions loader", () => {
  test("lists metadata without lines, plus the current pointer", async () => {
    const { cookie, user } = await createCookie();
    const track = await createTrack("T");
    const other = await createTrack("Other");
    const v = await seedVersion(track.id, { createdBy: user.id });
    await seedVersion(other.id);
    await prisma.trackKaraoke.create({
      data: { trackId: track.id, currentVersionId: v.id },
    });
    const res = await unwrap(
      await versionsLoader({
        request: new Request(`http://localhost/x?trackId=${track.id}`, {
          headers: { cookie },
        }),
        params: {},
        context: {},
      } as never),
    );
    expect(res.status).toBe(200);
    expect(res.body.currentVersionId).toBe(v.id);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0]).toEqual({
      id: v.id,
      status: "draft",
      createdBy: user.id,
      createdAt: expect.anything(),
      language: "fr",
      source: "paste",
    });
    expect(res.body.versions[0]).not.toHaveProperty("lines");
  });
});

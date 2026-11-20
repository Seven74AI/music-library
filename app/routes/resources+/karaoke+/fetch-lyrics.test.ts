import { parseString } from "set-cookie-parser";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// lookupLyrics itself is covered (with fixtures, no network) in lyrics-lookup.server.test.ts.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("#app/utils/lyrics-lookup.server.ts", () => ({ lookupLyrics: lookupMock }));
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";
import { action } from "./fetch-lyrics.tsx";

const originalMocks = process.env.MOCKS;
beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue({ ok: true, lyrics: "Mock line one\nMock line two" });
});
afterEach(() => {
  if (originalMocks === undefined) delete process.env.MOCKS;
  else process.env.MOCKS = originalMocks;
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
    request: new Request("http://localhost/resources/karaoke/fetch-lyrics", {
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

describe("fetch-lyrics", () => {
  test("requires auth", async () => {
    const res = await call(null, { trackId: "x" }).catch((e) => e);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
  });

  test("MOCKS returns fixed lyrics", async () => {
    process.env.MOCKS = "true";
    const cookie = await createCookie();
    const track = await createTrack("Song");
    const { status, body } = await unwrap(await call(cookie, { trackId: track.id }));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.lyrics).toMatch(/\S/);
  });

  test.each([
    ["not-found", 404],
    ["unavailable", 502],
  ] as const)("maps kind %s → %i", async (kind, expected) => {
    lookupMock.mockResolvedValueOnce({ ok: false, kind, error: "nope" });
    const cookie = await createCookie();
    const track = await createTrack("Song");
    const { status, body } = await unwrap(await call(cookie, { trackId: track.id }));
    expect(status).toBe(expected);
    expect(body).toMatchObject({ success: false, kind });
  });

  test("real lookup success → 200 with lyrics", async () => {
    lookupMock.mockResolvedValueOnce({ ok: true, lyrics: "real lyrics" });
    const cookie = await createCookie();
    const track = await createTrack("Song");
    const { status, body } = await unwrap(await call(cookie, { trackId: track.id }));
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, lyrics: "real lyrics" });
  });

  test("rate limit → 429 after the per-minute budget", async () => {
    lookupMock.mockResolvedValue({ ok: true, lyrics: "x" });
    const cookie = await createCookie();
    const track = await createTrack("Song");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await unwrap(await call(cookie, { trackId: track.id }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test("404 unknown track", async () => {
    process.env.MOCKS = "true";
    const cookie = await createCookie();
    const { status } = await unwrap(await call(cookie, { trackId: "nope" }));
    expect(status).toBe(404);
  });
});

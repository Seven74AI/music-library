import { parseString } from "set-cookie-parser";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "#tests/db-utils.ts";
import { action } from "./fetch-lyrics.tsx";

const originalMocks = process.env.MOCKS;
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

  test("non-MOCKS returns not-available error", async () => {
    process.env.MOCKS = "false";
    const cookie = await createCookie();
    const track = await createTrack("Song");
    const { status, body } = await unwrap(await call(cookie, { trackId: track.id }));
    expect(status).toBe(501);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not available/i);
  });

  test("404 unknown track", async () => {
    process.env.MOCKS = "true";
    const cookie = await createCookie();
    const { status } = await unwrap(await call(cookie, { trackId: "nope" }));
    expect(status).toBe(404);
  });
});

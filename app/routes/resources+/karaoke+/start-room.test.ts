import { describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createKaraokeTrack, createUserWithCookie } from "#tests/karaoke-fixtures.ts";
import { action } from "./start-room.tsx";

async function call(cookie: string, fields: Record<string, string>) {
  const result = (await action({
    request: new Request("http://localhost/resources/karaoke/start-room", {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as never)) as { data: any; init?: { status?: number } };
  return { status: result.init?.status ?? 200, body: result.data };
}

describe("start-room action", () => {
  test("rejects a non-ready track", async () => {
    const { cookie } = await createUserWithCookie();
    const draft = await createKaraokeTrack("SR draft", { version: { status: "draft" } });
    const none = await createKaraokeTrack("SR none", { version: null });
    for (const t of [draft, none]) {
      const res = await call(cookie, { trackId: t.id });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
    expect(await prisma.room.count()).toBe(0);
  });

  test("creates a karaoke room and enqueues the track", async () => {
    const { cookie } = await createUserWithCookie();
    const track = await createKaraokeTrack("SR ready", { version: { status: "ready" } });
    const res = await call(cookie, { trackId: track.id });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const room = await prisma.room.findFirst({
      where: { code: res.body.code },
      include: { queueItems: true },
    });
    expect(room?.kind).toBe("karaoke");
    expect(room?.queueItems.map((q) => q.trackId)).toEqual([track.id]);
  });
});

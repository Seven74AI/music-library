import { describe, expect, test } from "vitest";
import { createTrack } from "#tests/db-utils.ts";
import { createKaraokeTrack, createUserWithCookie } from "#tests/karaoke-fixtures.ts";
import { loader } from "./karaoke.tsx";

async function load(cookie: string, qs = "") {
  const result = await loader({
    request: new Request(`http://localhost/karaoke${qs}`, { headers: { cookie } }),
    params: {},
    context: {},
  } as never);
  return result as Awaited<ReturnType<typeof loader>>;
}

describe("/karaoke loader", () => {
  test("lists only tracks with a TrackKaraoke and handles null current version", async () => {
    const { cookie } = await createUserWithCookie();
    const ready = await createKaraokeTrack("K Ready", { version: { status: "ready" } });
    const orphan = await createKaraokeTrack("K NoVersion", { version: null });
    const plain = await createTrack("K Plain");

    const { items } = await load(cookie);
    const ids = items.map((i) => i.trackId);
    expect(ids).toContain(ready.id);
    expect(ids).toContain(orphan.id);
    expect(ids).not.toContain(plain.id);
    expect(items.find((i) => i.trackId === orphan.id)).toMatchObject({
      status: null,
      language: null,
      canStart: false,
    });
    expect(items.find((i) => i.trackId === ready.id)).toMatchObject({
      status: "ready",
      canStart: true,
    });
  });

  test("applies language and status filters against the current version", async () => {
    const { cookie } = await createUserWithCookie();
    const enReady = await createKaraokeTrack("F enReady", {
      version: { status: "ready", language: "en" },
    });
    const frDraft = await createKaraokeTrack("F frDraft", {
      version: { status: "draft", language: "fr" },
    });
    const none = await createKaraokeTrack("F none", { version: null });

    const en = (await load(cookie, "?language=en")).items.map((i) => i.trackId);
    expect(en).toContain(enReady.id);
    expect(en).not.toContain(frDraft.id);
    expect(en).not.toContain(none.id);

    const draft = (await load(cookie, "?status=draft")).items.map((i) => i.trackId);
    expect(draft).toContain(frDraft.id);
    expect(draft).not.toContain(enReady.id);

    const both = (await load(cookie, "?language=fr&status=ready")).items.map((i) => i.trackId);
    expect(both).not.toContain(frDraft.id);
    expect(both).not.toContain(enReady.id);

    const bogus = await load(cookie, "?language=xx&status=yy");
    expect(bogus.language).toBe("all");
    expect(bogus.status).toBe("all");
  });
});

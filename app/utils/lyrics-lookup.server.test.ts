import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  azSlug,
  lookupLyrics,
  MOCK_FETCHED_LYRICS,
  parseAzLyricsSong,
  parseGeniusSearch,
  parseGeniusSong,
  scrapeLyrics,
  type FetchFn,
} from "./lyrics-lookup.server.ts";

const fx = (name: string) =>
  readFileSync(`tests/fixtures/lyrics/${name}`, "utf8");
const lookup = { title: "Test Song", artist: "Test Artist" };

const GENIUS_LYRICS =
  "Hello & welcome\nLine two here\nIt's fine\n\nLa la la\nnested\nThe end";
const AZ_LYRICS = "Hello & welcome\nLine two here\n\nLa la la";

/** Route-by-URL fake fetch; unmatched URLs return 404. */
function fakeFetch(routes: Record<string, string | number | Error>) {
  const calls: string[] = [];
  const fn: FetchFn = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([prefix]) =>
      url.startsWith(prefix),
    );
    if (!hit) return new Response("nope", { status: 404 });
    const [, v] = hit;
    if (v instanceof Error) throw v;
    if (typeof v === "number") return new Response("err", { status: v });
    return new Response(v, { status: 200 });
  };
  return { fn, calls };
}

const GENIUS_SEARCH = "https://genius.com/api/search/song";
const GENIUS_SONG = "https://genius.com/Test-artist-test-song-lyrics";
const AZ = "https://www.azlyrics.com/lyrics/testartist/testsong.html";

describe("parsers (fixtures)", () => {
  test("genius search picks the best song and only genius.com", () => {
    expect(
      parseGeniusSearch(JSON.parse(fx("genius-search.json")), lookup),
    ).toBe(GENIUS_SONG);
    expect(
      parseGeniusSearch(JSON.parse(fx("genius-search-evil-host.json")), lookup),
    ).toBeNull();
    expect(
      parseGeniusSearch(JSON.parse(fx("genius-search-empty.json")), lookup),
    ).toBeNull();
  });
  test("genius song → clean lyrics", () => {
    expect(parseGeniusSong(fx("genius-song.html"))).toBe(GENIUS_LYRICS);
    expect(parseGeniusSong(fx("no-results.html"))).toBeNull();
  });
  test("azlyrics song → clean lyrics", () => {
    expect(parseAzLyricsSong(fx("azlyrics-song.html"))).toBe(AZ_LYRICS);
    expect(parseAzLyricsSong(fx("no-results.html"))).toBeNull();
  });
  test("azSlug", () => {
    expect(azSlug("The Beatles", true)).toBe("beatles");
    expect(azSlug("Don't Stop (Live)")).toBe("dontstoplive");
  });
});

const song = (url: string, title: string, artist: string) => ({
  response: {
    sections: [
      {
        hits: [
          {
            type: "song",
            result: { url, title, primary_artist: { name: artist } },
          },
        ],
      },
    ],
  },
});

describe("hardening", () => {
  test("S1: out-of-range numeric entity does not throw", () => {
    const html =
      '<div data-lyrics-container="true">a &#99999999; b &#x110000; c &#65;</div>';
    expect(parseGeniusSong(html)).toBe("a &#99999999; b &#x110000; c A");
  });
  test("S2: body read failure → unavailable", async () => {
    const fn: FetchFn = async () =>
      ({
        status: 200,
        ok: true,
        url: "",
        text: async () => {
          throw new Error("reset");
        },
      }) as unknown as Response;
    expect(await scrapeLyrics(lookup, fn)).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });
  test("S3: concurrent lookups while down both return unavailable", async () => {
    const prev = process.env.MOCKS;
    process.env.MOCKS = "false";
    try {
      const t = { title: `Conc ${Math.random()}`, artist: "Conc" };
      const down = vi.fn<FetchFn>(
        async () => new Response("x", { status: 503 }),
      );
      const [a, b] = await Promise.all([
        lookupLyrics(t, down),
        lookupLyrics(t, down),
      ]);
      expect(a).toMatchObject({ kind: "unavailable" });
      expect(b).toMatchObject({ kind: "unavailable" });
    } finally {
      if (prev === undefined) delete process.env.MOCKS;
      else process.env.MOCKS = prev;
    }
  });
  test("S4: non-Latin names never fuzzy-match; substring needs word boundary", () => {
    const cyr = song("https://genius.com/x", "Другая", "Кино");
    expect(parseGeniusSearch(cyr, { title: "歌", artist: "歌手" })).toBeNull();
    expect(parseGeniusSearch(cyr, { title: "Другая", artist: "Кино" })).toBe(
      "https://genius.com/x",
    );
    const sub = song("https://genius.com/y", "Lovesong", "Test Artist");
    expect(
      parseGeniusSearch(sub, { title: "Love", artist: "Test Artist" }),
    ).toBeNull();
  });
  test("S5: redirect to foreign host is rejected", async () => {
    const fn: FetchFn = async () => {
      const r = new Response("x", { status: 200 });
      Object.defineProperty(r, "url", { value: "https://evil.example/x" });
      return r;
    };
    expect(await scrapeLyrics(lookup, fn)).toMatchObject({
      kind: "unavailable",
    });
  });
  test("genius song URL with port/credentials is rejected", () => {
    for (const url of [
      "https://genius.com:8443/x",
      "https://user:pw@genius.com/x",
    ]) {
      expect(
        parseGeniusSearch(song(url, "Test Song", "Test Artist"), lookup),
      ).toBeNull();
    }
  });
});

describe("scrapeLyrics", () => {
  test("genius hit", async () => {
    const { fn, calls } = fakeFetch({
      [GENIUS_SEARCH]: fx("genius-search.json"),
      [GENIUS_SONG]: fx("genius-song.html"),
    });
    expect(await scrapeLyrics(lookup, fn)).toEqual({
      ok: true,
      lyrics: GENIUS_LYRICS,
    });
    expect(calls.every((u) => new URL(u).hostname === "genius.com")).toBe(true);
  });

  test("genius miss → azlyrics fallback", async () => {
    const { fn, calls } = fakeFetch({
      [GENIUS_SEARCH]: fx("genius-search-empty.json"),
      [AZ]: fx("azlyrics-song.html"),
    });
    expect(await scrapeLyrics(lookup, fn)).toEqual({
      ok: true,
      lyrics: AZ_LYRICS,
    });
    expect(calls[calls.length - 1]).toBe(AZ);
  });

  test("both miss → not-found", async () => {
    const { fn } = fakeFetch({
      [GENIUS_SEARCH]: fx("genius-search-empty.json"),
      [AZ]: fx("no-results.html"),
    });
    expect(await scrapeLyrics(lookup, fn)).toMatchObject({
      ok: false,
      kind: "not-found",
    });
  });

  test("network error everywhere → unavailable", async () => {
    const { fn } = fakeFetch({
      [GENIUS_SEARCH]: new Error("ECONNRESET"),
      [AZ]: new Error("ECONNRESET"),
    });
    expect(await scrapeLyrics(lookup, fn)).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });

  test("HTTP 5xx/403 → unavailable", async () => {
    const { fn } = fakeFetch({ [GENIUS_SEARCH]: 403, [AZ]: 503 });
    expect(await scrapeLyrics(lookup, fn)).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });

  test("genius down but azlyrics has it → ok", async () => {
    const { fn } = fakeFetch({
      [GENIUS_SEARCH]: 503,
      [AZ]: fx("azlyrics-song.html"),
    });
    expect(await scrapeLyrics(lookup, fn)).toEqual({
      ok: true,
      lyrics: AZ_LYRICS,
    });
  });

  test("sends a browser user-agent", async () => {
    const spy = vi.fn<FetchFn>(async () => new Response("{}", { status: 404 }));
    await scrapeLyrics(lookup, spy);
    const init = spy.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
      /Mozilla/,
    );
    expect(init.signal).toBeDefined();
  });
});

describe("lookupLyrics (cached)", () => {
  const prevMocks = process.env.MOCKS;
  beforeEach(() => {
    process.env.MOCKS = "false";
  });
  afterEach(() => {
    if (prevMocks === undefined) delete process.env.MOCKS;
    else process.env.MOCKS = prevMocks;
  });
  test("caches successes; does not cache unavailable", async () => {
    const t = { title: `Cache ${Math.random()}`, artist: "Cacher" };
    const down = vi.fn<FetchFn>(async () => new Response("x", { status: 503 }));
    expect(await lookupLyrics(t, down)).toMatchObject({ kind: "unavailable" });
    expect(await lookupLyrics(t, down)).toMatchObject({ kind: "unavailable" });
    expect(down.mock.calls.length).toBeGreaterThan(2); // refetched, not cached

    const ok = fakeFetch({
      "https://genius.com/api/search/song": fx("genius-search-empty.json"),
      "https://www.azlyrics.com/": fx("azlyrics-song.html"),
    });
    expect(await lookupLyrics(t, ok.fn)).toMatchObject({ ok: true });
    const n = ok.calls.length;
    expect(
      await lookupLyrics({ ...t, title: t.title.toUpperCase() }, ok.fn),
    ).toMatchObject({
      ok: true,
    });
    expect(ok.calls.length).toBe(n); // cache hit
  });

  test("MOCKS returns mock lyrics without fetching", async () => {
    process.env.MOCKS = "true";
    const spy = vi.fn<FetchFn>();
    expect(await lookupLyrics(lookup, spy)).toEqual({
      ok: true,
      lyrics: MOCK_FETCHED_LYRICS,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

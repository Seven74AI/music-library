/**
 * Lyrics lookup: Genius first, AZLyrics fallback. Pure HTML/JSON scraping, no API token.
 *
 * SSRF-safe by construction: hosts are fixed (genius.com / www.azlyrics.com); only
 * URL-encoded title/artist/slug vary. The one URL taken from a remote response (the Genius
 * song URL) is re-validated against the fixed host before being fetched.
 *
 * The DOM selectors are a best-effort against the known site structure; the fixtures in
 * `tests/fixtures/lyrics/` are the contract. Re-verify live if a parser regresses.
 */
import { cache, cachified } from "#app/utils/cache.server.ts";

export type LyricsLookup = { title: string; artist: string };
export type LyricsResult =
  | { ok: true; lyrics: string }
  | { ok: false; kind: "not-found" | "unavailable"; error: string };
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const MOCK_FETCHED_LYRICS =
  "Mock line one\nMock line two\nMock line three";

const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

class ProviderUnavailableError extends Error {}

// ---------- HTML helpers ----------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1]?.toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      // Clamp so a malformed entity (e.g. &#99999999;) can never make fromCodePoint throw.
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Convert a lyrics HTML fragment to plain text: <br> → newline, strip tags, decode entities. */
function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/\s*\n\s*/g, " ") // source newlines are insignificant in HTML; <br> carries breaks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Inner HTML of every <div> whose opening tag matches `openRe` (depth-aware for nested divs). */
function extractDivs(html: string, openRe: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(openRe.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = start;
    let depth = 1;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(start, t.index));
        re.lastIndex = t.index;
        break;
      }
    }
  }
  return out;
}

export function normalizeLyrics(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/\[[^\]\n]*\]/g, "") // [Verse 1] / [Chorus] annotation markers
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Genius ----------

const GENIUS_HOST = "genius.com";

/** Fixture contract: tests/fixtures/lyrics/genius-search.json */
export function parseGeniusSearch(
  json: unknown,
  lookup: LyricsLookup,
): string | null {
  const sections = (json as any)?.response?.sections;
  if (!Array.isArray(sections)) return null;
  const hits: Array<{ url?: string; title?: string; artist?: string }> = [];
  for (const section of sections) {
    for (const hit of (section as { hits?: any[] } | null)?.hits ?? []) {
      if (hit?.type && hit.type !== "song") continue;
      const r = hit?.result;
      if (r?.url)
        hits.push({
          url: r.url,
          title: r.title,
          artist: r.primary_artist?.name,
        });
    }
  }
  // Unicode-aware: strip diacritics, keep letters/digits of any script, space-separated words.
  const key = (s?: string) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const wantArtist = key(lookup.artist);
  const wantTitle = key(lookup.title);
  // An empty key would match anything; refuse to guess.
  if (!wantArtist || !wantTitle) return null;
  const hasPhrase = (hay: string, needle: string) =>
    ` ${hay} `.includes(` ${needle} `);
  const best =
    hits.find(
      (h) => key(h.artist) === wantArtist && key(h.title) === wantTitle,
    ) ??
    hits.find((h) => {
      const a = key(h.artist);
      const t = key(h.title);
      if (!a || !t) return false;
      return (
        (hasPhrase(a, wantArtist) || hasPhrase(wantArtist, a)) &&
        hasPhrase(t, wantTitle)
      );
    });
  if (!best?.url) return null;
  try {
    const u = new URL(best.url);
    // SSRF guard: full origin (scheme+host+port), no embedded credentials.
    if (u.origin !== `https://${GENIUS_HOST}` || u.username || u.password)
      return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Fixture contract: tests/fixtures/lyrics/genius-song.html (`data-lyrics-container="true"`). */
export function parseGeniusSong(html: string): string | null {
  const blocks = extractDivs(
    html,
    /<div\b[^>]*data-lyrics-container="true"[^>]*>/,
  );
  const text = normalizeLyrics(blocks.map(htmlToText).join("\n"));
  return text || null;
}

const ALLOWED_HOSTS = new Set([
  "genius.com",
  "www.genius.com",
  "azlyrics.com",
  "www.azlyrics.com",
]);

async function fetchText(
  fetchFn: FetchFn,
  url: string,
  accept: string,
): Promise<string | null> {
  try {
    const res = await fetchFn(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept,
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (res.url) {
      // fetch followed redirects: re-validate the final target.
      const final = new URL(res.url);
      if (
        final.protocol !== "https:" ||
        !ALLOWED_HOSTS.has(final.hostname) ||
        final.port
      ) {
        throw new ProviderUnavailableError(
          `unexpected redirect target ${final.hostname}`,
        );
      }
    }
    if (res.status === 404) return null;
    if (!res.ok)
      throw new ProviderUnavailableError(
        `${new URL(url).hostname} returned ${res.status}`,
      );
    return await res.text(); // inside the try: the timeout also covers the body read
  } catch (e) {
    if (e instanceof ProviderUnavailableError) throw e;
    throw new ProviderUnavailableError(
      `network error fetching ${new URL(url).hostname}`,
    );
  }
}

async function fromGenius(
  fetchFn: FetchFn,
  lookup: LyricsLookup,
): Promise<string | null> {
  const q = encodeURIComponent(`${lookup.artist} ${lookup.title}`);
  const searchBody = await fetchText(
    fetchFn,
    `https://genius.com/api/search/song?per_page=5&q=${q}`,
    "application/json",
  );
  if (!searchBody) return null;
  let json: unknown;
  try {
    json = JSON.parse(searchBody);
  } catch {
    throw new ProviderUnavailableError(
      "genius.com returned a non-JSON search response",
    );
  }
  const songUrl = parseGeniusSearch(json, lookup);
  if (!songUrl) return null;
  const html = await fetchText(fetchFn, songUrl, "text/html");
  return html ? parseGeniusSong(html) : null;
}

// ---------- AZLyrics ----------

/** AZLyrics slug: lowercase, alphanumerics only; artist drops a leading "the". */
export function azSlug(s: string, dropThe = false) {
  let v = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (dropThe) v = v.replace(/^the\s+/, "");
  return v.replace(/[^a-z0-9]/g, "");
}

/**
 * Fixture contract: tests/fixtures/lyrics/azlyrics-song.html. The lyrics live in the class-less
 * <div> that follows the "Usage of azlyrics.com content ..." comment.
 */
export function parseAzLyricsSong(html: string): string | null {
  const marker = html.search(/<!--\s*Usage of azlyrics\.com content/i);
  if (marker === -1) return null;
  const rest = html.slice(marker);
  const divs = extractDivs(rest, /<div>/);
  const text = normalizeLyrics(
    htmlToText((divs[0] ?? "").replace(/<!--[\s\S]*?-->/g, "")),
  );
  return text || null;
}

async function fromAzLyrics(
  fetchFn: FetchFn,
  lookup: LyricsLookup,
): Promise<string | null> {
  const artist = azSlug(lookup.artist, true);
  const song = azSlug(lookup.title);
  if (!artist || !song) return null;
  const html = await fetchText(
    fetchFn,
    `https://www.azlyrics.com/lyrics/${artist}/${song}.html`,
    "text/html",
  );
  return html ? parseAzLyricsSong(html) : null;
}

// ---------- Public API ----------

/** Uncached, injectable-fetch lookup. Genius → AZLyrics. */
export async function scrapeLyrics(
  lookup: LyricsLookup,
  fetchFn: FetchFn = fetch,
): Promise<LyricsResult> {
  let unavailable: string | null = null;
  for (const provider of [fromGenius, fromAzLyrics]) {
    try {
      const lyrics = await provider(fetchFn, lookup);
      if (lyrics) return { ok: true, lyrics };
    } catch (e) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      unavailable = e.message;
    }
  }
  // A provider being down only matters if the other one didn't find anything either.
  return unavailable
    ? {
        ok: false,
        kind: "unavailable",
        error: "Lyrics providers are unavailable right now",
      }
    : { ok: false, kind: "not-found", error: "No lyrics found for this track" };
}

const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Cached lookup (5 min TTL, keyed by normalized title+artist). `unavailable` outcomes are
 * never cached (retryable); `ok` and `not-found` are.
 */
export async function lookupLyrics(
  lookup: LyricsLookup,
  fetchFn: FetchFn = fetch,
): Promise<LyricsResult> {
  if (process.env.MOCKS === "true")
    return { ok: true, lyrics: MOCK_FETCHED_LYRICS };
  const key = `lyrics:${JSON.stringify([normKey(lookup.artist), normKey(lookup.title)])}`;
  const result = await cachified(
    {
      key,
      cache,
      ttl: CACHE_TTL_MS,
      getFreshValue: async () => {
        const r = await scrapeLyrics(lookup, fetchFn);
        if (!r.ok && r.kind === "unavailable") {
          throw new ProviderUnavailableError(r.error);
        }
        return r;
      },
    },
    () => () => {},
  ).catch((e) => {
    // (noop reporter above: "unavailable" is an expected outcome, not a logged error)
    // Concurrent callers share the first caller's rejection, so classify by error type.
    if (e instanceof ProviderUnavailableError) {
      return {
        ok: false,
        kind: "unavailable",
        error: e.message,
      } as LyricsResult;
    }
    throw e;
  });
  return result;
}

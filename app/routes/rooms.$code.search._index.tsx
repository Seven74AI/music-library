/**
 * Party-room search. Album and artist hits open inside this shell.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { RoomCatalogTrackRow } from "#app/components/party-room/room-catalog-track-row.tsx";
import { useRoomCatalogActions } from "#app/components/party-room/room-catalog-actions.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import {
  parseRoomBrowseType,
  roomAlbumHref,
  roomArtistHref,
  type RoomBrowseType,
  type RoomCatalogTrack,
  type RoomSearchReturnState,
} from "#app/features/party-room/room-browse.ts";
import { type SearchResult, type TrackSearchResult } from "#app/types/search.ts";
import { cn } from "#app/utils/misc.tsx";

const TYPE_FILTERS: Array<{ value: RoomBrowseType; label: string }> = [
  { value: "all", label: "All" },
  { value: "tracks", label: "Tracks" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
];

function toCatalogTrack(result: TrackSearchResult): RoomCatalogTrack {
  return {
    id: result.id,
    title: result.title,
    artistName: result.artistName,
    artistId: result.artistId,
    albumName: result.albumName ?? null,
    albumId: result.albumId ?? null,
    duration: result.duration ?? null,
  };
}

export default function GuestSearchTab() {
  const { code, canAdd } = useRoomCatalogActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialType = parseRoomBrowseType(searchParams.get("type"));
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<RoomBrowseType>(initialType);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => initialQuery.trim().length > 0);
  const requestRef = useRef(0);
  const immediateRef = useRef(true);

  const returnState: RoomSearchReturnState = { q: query.trim(), type };

  useEffect(() => {
    const q = query.trim();
    const delay = immediateRef.current || !q ? 0 : 280;
    immediateRef.current = false;
    const handle = window.setTimeout(() => {
      writeSearchParams(q, type);
      if (!q) {
        requestRef.current += 1;
        setResults([]);
        setNextCursor(null);
        setError(null);
        setLoading(false);
        return;
      }
      void runSearch({ q, type, cursor: null, append: false });
    }, delay);
    return () => {
      window.clearTimeout(handle);
      requestRef.current += 1;
    };
    // runSearch and writeSearchParams close over the latest `code` and
    // `searchParams` from this effect's render. The exhaustive-deps rule flags
    // the component-scoped helpers; `searchParams` is only ever mutated by
    // writeSearchParams itself, so reading it from the closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, code]);

  function writeSearchParams(q: string, nextType: RoomBrowseType) {
    // Compare against the current URL params and skip the navigation when they
    // already match. (setSearchParams' functional updater always navigates, so
    // a no-op check inside it would still trigger a redundant replace-navigation
    // and re-run the route loader.)
    const currentQ = searchParams.get("q") ?? "";
    const currentType = parseRoomBrowseType(searchParams.get("type"));
    if (currentQ === q && currentType === nextType) return;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nextType !== "all") params.set("type", nextType);
    setSearchParams(params, { replace: true });
  }

  async function runSearch(args: {
    q: string;
    type: RoomBrowseType;
    cursor: string | null;
    append: boolean;
  }) {
    const id = ++requestRef.current;
    setLoading(true);
    if (!args.append) setError(null);
    try {
      const params = new URLSearchParams({
        q: args.q,
        type: args.type,
        limit: "20",
      });
      if (args.cursor) params.set("cursor", args.cursor);
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/search?${params}`, {
        credentials: "same-origin",
      });
      if (id !== requestRef.current) return;
      if (res.status === 401) {
        setError("Join the room to search");
        if (!args.append) setResults([]);
        setNextCursor(null);
        return;
      }
      if (res.status === 429) {
        setError("Too many searches — wait a moment");
        return;
      }
      if (!res.ok) {
        setError("Search failed");
        return;
      }
      const body = (await res.json()) as {
        results?: SearchResult[];
        pagination?: { nextCursor?: string | null };
      };
      if (id !== requestRef.current) return;
      const page = body.results ?? [];
      setResults((prev) => (args.append ? [...prev, ...page] : page));
      setNextCursor(body.pagination?.nextCursor ?? null);
      setError(null);
    } catch {
      if (id !== requestRef.current) return;
      setError("Search failed");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Search</h2>
        <p className="text-sm text-muted-foreground">
          Playable catalog. Open an album or artist, or audition a track on this device.
          {canAdd
            ? " Add to queue from your role."
            : " Audition to preview — add requires DJ/Host."}
        </p>
      </div>

      <div className="relative">
        <Icon
          name="magnifying-glass"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim()) setLoading(true);
          }}
          placeholder="Search artists, albums, tracks…"
          aria-label="Search artists, albums, and tracks"
          className="pr-10 pl-9"
          autoComplete="off"
          enterKeyHint="search"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <Icon name="cross-1" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Result type">
        {TYPE_FILTERS.map((filter) => {
          const selected = type === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setType(filter.value);
                if (query.trim()) setLoading(true);
              }}
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                selected ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80",
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {loading && results.length === 0 && query.trim() ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="space-y-1" aria-busy={loading}>
          {results.map((result) => {
            if (result.type === "track") {
              return (
                <RoomCatalogTrackRow
                  key={`track-${result.id}`}
                  track={toCatalogTrack(result)}
                  returnState={returnState}
                />
              );
            }
            if (result.type === "album") {
              return (
                <li key={`album-${result.id}`}>
                  <Link
                    to={roomAlbumHref(code, result.id)}
                    state={returnState}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon name="camera" className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        Album · {result.artistName}
                        {result.year ? ` · ${result.year}` : ""}
                      </span>
                    </span>
                    <Icon name="arrow-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            }
            if (result.type === "artist") {
              return (
                <li key={`artist-${result.id}`}>
                  <Link
                    to={roomArtistHref(code, result.id)}
                    state={returnState}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon name="avatar" className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {result.genre ? `Artist · ${result.genre}` : "Artist"}
                      </span>
                    </span>
                    <Icon name="arrow-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            }
            return null;
          })}
        </ul>
      ) : null}

      {!loading && query.trim() && results.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No playable matches for “{query.trim()}”.</p>
      ) : null}

      {!query.trim() && !loading ? (
        <div className="flex flex-col items-center px-4 py-12 text-center">
          <Icon name="magnifying-glass" className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="max-w-xs text-sm text-muted-foreground">
            Search for a song, album, or artist. Open a result to browse its playable tracks.
          </p>
        </div>
      ) : null}

      {nextCursor ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() =>
              void runSearch({ q: query.trim(), type, cursor: nextCursor, append: true })
            }
            disabled={loading}
            className="rounded-full bg-muted px-4 py-1.5 text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

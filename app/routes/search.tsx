/**
 * Search page — full-screen overlay with Spotify-like UX
 * Debounced results, mixed feed, type filter, recent searches
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  data,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { InRoomChip } from "#app/components/party-room/in-room-chip.tsx";
import { SearchResults } from "#app/components/search-results.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { isCurrentHost, splitRoomQueue } from "#app/features/party-room/index.ts";
import { useOptionalPartyRoom } from "#app/features/party-room/party-room-provider.tsx";
import { type RoomSnapshot } from "#app/features/party-room/types.ts";
import { type SearchResponse, type SearchResult, isSearchResponse } from "#app/types/search.ts";
import { getUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { cn } from "#app/utils/misc.tsx";
import { type Route } from "./+types/search.ts";

/**
 * Listener now-playing bar sits at z-50, above the bottom nav and below dialogs (z-53).
 * Inset this overlay (z-52) by the bar offset plus the bar height instead of raising the bar.
 */
const ROOM_BAR_CLEARANCE =
  "calc(var(--bottom-bar-height, 64px) + var(--player-error-height, 0px) + env(safe-area-inset-bottom) + 4rem)";

function listenerRoomBarVisible(room: RoomSnapshot | null): boolean {
  if (!room || room.status !== "open" || isCurrentHost(room)) return false;
  return splitRoomQueue(room).nowPlaying != null;
}

const RECENT_SEARCHES_KEY = "music-library:recent-searches";
const SEARCH_SCOPE_KEY = "music-library:search-scope";
const MAX_RECENT = 8;

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function getSearchScope(): "library" | "all" {
  if (typeof window === "undefined") return "all";
  try {
    const raw = localStorage.getItem(SEARCH_SCOPE_KEY);
    if (raw === "library" || raw === "all") return raw;
    return "all";
  } catch {
    return "all";
  }
}

function setSearchScope(scope: "library" | "all") {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEARCH_SCOPE_KEY, scope);
}

function addRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  const trimmed = query.trim();
  if (!trimmed) return;
  const current = getRecentSearches().filter((q) => q !== trimmed);
  current.unshift(trimmed);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(current.slice(0, MAX_RECENT)));
}

function removeRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  const current = getRecentSearches().filter((q) => q !== query);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(current));
}

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "tracks", label: "Tracks" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
  { value: "playlists", label: "Playlists" },
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (!userId) {
    return data({ playlists: [] });
  }

  const playlists = await prisma.userPlaylist.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      title: true,
      description: true,
      _count: {
        select: { tracks: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return data({ playlists });
}

export default function SearchPage() {
  const { playlists } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const party = useOptionalPartyRoom();
  const fetcher = useFetcher<SearchResponse>({ key: "search" });
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialQuery = searchParams.get("q") ?? "";
  const initialType = searchParams.get("type") ?? "all";

  const [query, setQuery] = useState(initialQuery);
  const [activeType, setActiveType] = useState(initialType);
  const [activeScope, setActiveScope] = useState<"library" | "all">(() => getSearchScope());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => getRecentSearches());

  const searchData = fetcher.data as SearchResponse | undefined;
  const isLoadMore = useRef(false);
  const [accumulated, setAccumulated] = useState<SearchResult[]>([]);

  // Merge fetcher results: replace on new search, append on load more
  useEffect(() => {
    if (!searchData) return;
    if (!isSearchResponse(searchData)) {
      if (!isLoadMore.current) {
        setAccumulated([]);
      }
      isLoadMore.current = false;
      return;
    }
    if (isLoadMore.current) {
      setAccumulated((prev) => [...prev, ...searchData.results]);
      isLoadMore.current = false;
    } else {
      setAccumulated(searchData.results);
    }
  }, [searchData]);

  const results = accumulated;
  const hasNext = isSearchResponse(searchData) ? searchData.pagination.hasNext : false;
  const isLoading = fetcher.state === "loading";
  const hasError =
    fetcher.state === "idle" &&
    query.trim().length > 0 &&
    searchData != null &&
    typeof searchData === "object" &&
    "error" in searchData &&
    Boolean((searchData as { error?: unknown }).error);

  // Auto-focus the input on every navigation to the search page
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [location.key]);

  // Debounced search
  const doSearch = useCallback(
    (q: string, type: string, scope: "library" | "all", options?: { immediate?: boolean }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Reset accumulated results for new search
      setAccumulated([]);
      isLoadMore.current = false;

      if (!q.trim()) {
        fetcher.load("/api/search");
        return;
      }

      const run = () => {
        const params = new URLSearchParams({ q: q.trim(), type, scope });
        fetcher.load(`/api/search?${params}`);
      };

      if (options?.immediate) {
        run();
        return;
      }

      debounceRef.current = setTimeout(run, 400);
    },
    [fetcher],
  );

  const queryFromUrl = searchParams.get("q") ?? "";
  const typeFromUrl = searchParams.get("type") ?? "all";
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;
  const doSearchRef = useRef(doSearch);
  doSearchRef.current = doSearch;

  // Opening /search?q=... runs that search without another keystroke.
  useEffect(() => {
    if (!queryFromUrl.trim()) return;
    setQuery(queryFromUrl);
    setActiveType(typeFromUrl);
    doSearchRef.current(queryFromUrl, typeFromUrl, activeScopeRef.current, { immediate: true });
  }, [queryFromUrl, typeFromUrl]);

  const roomOpen = party?.room?.status === "open";
  const roomBarVisible = listenerRoomBarVisible(party?.room ?? null);

  // Handle input changes
  const handleInputChange = (value: string) => {
    setQuery(value);
    doSearch(value, activeType, activeScope);
  };

  // Handle type filter change
  const handleTypeChange = (type: string) => {
    setActiveType(type);
    doSearch(query, type, activeScope);
  };

  // Handle scope change
  const handleScopeChange = (scope: "library" | "all") => {
    setActiveScope(scope);
    setSearchScope(scope);
    doSearch(query, activeType, scope);
  };

  // Handle cancel / back
  const handleCancel = () => {
    navigate(-1);
  };

  // Handle search submission (Enter key)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    // Save to recent searches
    addRecentSearch(trimmed);
    setRecentSearches(getRecentSearches());

    // Update URL
    const params = new URLSearchParams({ q: trimmed, type: activeType });
    navigate(`/search?${params}`, { replace: true });
  };

  // Handle clicking a recent search
  const handleRecentClick = (q: string) => {
    setQuery(q);
    addRecentSearch(q);
    setRecentSearches(getRecentSearches());
    setAccumulated([]);
    isLoadMore.current = false;
    const params = new URLSearchParams({ q, type: activeType, scope: activeScope });
    navigate(`/search?${params}`, { replace: true });
    fetcher.load(`/api/search?${params}`);
  };

  // Handle load more
  const handleLoadMore = () => {
    const cursor = isSearchResponse(searchData) ? searchData.pagination.nextCursor : null;
    if (!cursor) return;
    isLoadMore.current = true;
    const params = new URLSearchParams({
      q: query.trim(),
      type: activeType,
      scope: activeScope,
      cursor,
    });
    fetcher.load(`/api/search?${params}`);
  };

  const showRecentSearches = !query.trim() && !isLoading;
  const showResults = query.trim().length > 0;

  return (
    <OfflineRouteBlocker>
      <div
        data-testid="search-overlay"
        className={cn(
          "fixed z-52 flex flex-col bg-background",
          roomBarVisible ? "inset-x-0 top-0" : "inset-0 h-dvh",
        )}
        style={roomBarVisible ? { bottom: ROOM_BAR_CLEARANCE } : undefined}
      >
        {/* Header with search bar */}
        <div className="shrink-0 border-b">
          {roomOpen ? (
            <div className="container flex items-center pt-3">
              <InRoomChip />
            </div>
          ) : null}
          <div className="container flex items-center gap-3 py-3">
            {/* Back arrow */}
            <button
              onClick={handleCancel}
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
              aria-label="Back"
            >
              <Icon name="arrow-left" className="h-5 w-5" />
            </button>

            {/* Search form */}
            <form onSubmit={handleSubmit} className="relative flex-1">
              <Icon
                name="magnifying-glass"
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                type="search"
                name="q"
                placeholder="What do you want to listen to?"
                value={query}
                onChange={(e) => handleInputChange(e.target.value)}
                className="h-12 pl-10 pr-4 text-lg"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setActiveType("all");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-muted"
                  aria-label="Clear search"
                >
                  <Icon name="cross-1" className="h-4 w-4" />
                </button>
              )}
            </form>
          </div>

          {/* Scope toggle - above type filters */}
          <div className="container flex gap-2 border-b pb-2 pt-1">
            <button
              onClick={() => handleScopeChange("all")}
              aria-label="Search all tracks"
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeScope === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              All Tracks
            </button>
            <button
              onClick={() => handleScopeChange("library")}
              aria-label="Search my library"
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeScope === "library"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              My Library
            </button>
          </div>

          {/* Type filter pills */}
          <div className="container flex gap-2 overflow-x-auto pb-2 pt-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => handleTypeChange(f.value)}
                aria-label={`Filter by ${f.label.toLowerCase()}`}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeType === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="container py-4">
            {/* Recent searches (only when no query is entered) */}
            {showRecentSearches && recentSearches.length > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-semibold">Recent</h2>
                <div className="space-y-1">
                  {recentSearches.map((q) => (
                    <div
                      key={q}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50"
                    >
                      <button
                        onClick={() => handleRecentClick(q)}
                        className="flex flex-1 items-center gap-3 text-left"
                      >
                        <Icon name="magnifying-glass" className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{q}</span>
                      </button>
                      <button
                        onClick={() => {
                          removeRecentSearch(q);
                          setRecentSearches(getRecentSearches());
                        }}
                        className="rounded-full p-1 hover:bg-muted"
                        aria-label={`Remove "${q}" from recent searches`}
                      >
                        <Icon name="cross-1" className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state when no query and no recent searches */}
            {showRecentSearches && recentSearches.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Icon name="magnifying-glass" className="mb-4 h-16 w-16 text-muted-foreground/30" />
                <p className="text-lg text-muted-foreground">
                  Search for tracks, albums, artists, and playlists
                </p>
              </div>
            )}

            {/* Results */}
            {showResults && !hasError && (
              <SearchResults
                results={results}
                query={query}
                onLoadMore={handleLoadMore}
                hasNext={hasNext}
                isLoading={isLoading}
                playlists={playlists}
                scope={activeScope}
              />
            )}

            {/* Error state */}
            {hasError && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Icon name="magnifying-glass" className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">Something went wrong</h3>
                <p className="text-muted-foreground">
                  Could not complete your search. Please try again.
                </p>
              </div>
            )}

            {/* Loading state for initial search */}
            {isLoading && showResults && results.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
        </div>
      </div>
    </OfflineRouteBlocker>
  );
}

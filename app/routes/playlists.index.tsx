import { useEffect, useRef, useState } from "react";
import { data, NavLink, useFetcher, useSearchParams } from "react-router";
import { InfiniteScrollSentinel } from "#app/components/infinite-scroll-sentinel.tsx";
import { OfflinePlaylistsIndexView } from "#app/components/offline/offline-playlists-index-view.tsx";
import { PlaylistCard } from "#app/components/playlist-card";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { type PlaylistsIndexOfflineLoaderData } from "#app/features/offline-app/offline-route-policies.client.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { cn } from "#app/utils/misc.tsx";
import { type Prisma } from "#prisma/client.js";
import { type Route } from "./+types/playlists.index.ts";

const SORT_OPTIONS = ["name", "created", "updated", "tracks"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const SORT_ORDER: Record<SortOption, Prisma.UserPlaylistOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: "desc" }, { id: "desc" }],
  created: [{ createdAt: "desc" }, { id: "desc" }],
  name: [{ title: "asc" }, { id: "asc" }],
  tracks: [{ tracks: { _count: "desc" } }, { id: "desc" }],
};

function parseSort(raw: string | null): SortOption {
  return SORT_OPTIONS.includes(raw as SortOption) ? (raw as SortOption) : "updated";
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const sort = parseSort(url.searchParams.get("sort"));
  const q = (url.searchParams.get("q") ?? "").trim();
  const cursor = url.searchParams.get("cursor") || undefined;

  const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "12", 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 12;

  const where: Prisma.UserPlaylistWhereInput = {
    ownerId: userId,
    ...(q
      ? {
          OR: [{ title: { contains: q } }, { description: { contains: q } }],
        }
      : {}),
  };

  // Fetch one extra row to know whether another page exists without a second
  // query. Cursor pagination is keyset-style: the `id` tiebreaker keeps the
  // order deterministic across every sort (including by track count).
  const playlists = await prisma.userPlaylist.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      tracks: {
        select: {
          id: true,
          position: true,
          track: {
            select: {
              id: true,
              title: true,
              artist: {
                select: {
                  id: true,
                  name: true,
                },
              },
              duration: true,
              coverImage: {
                select: {
                  objectKey: true,
                },
              },
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: SORT_ORDER[sort],
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
  });

  const hasNext = playlists.length > limit;
  const page = hasNext ? playlists.slice(0, limit) : playlists;
  const nextCursor = hasNext ? (page[page.length - 1]?.id ?? null) : null;

  return data({
    playlists: page,
    pagination: {
      limit,
      hasNext,
      nextCursor,
    },
    sort,
    q,
  });
}

type ViewMode = "grid" | "list";
type LoaderData = Route.ComponentProps["loaderData"];

export default function PlaylistsIndexRoute({
  loaderData,
}: {
  loaderData: LoaderData | PlaylistsIndexOfflineLoaderData;
}) {
  const offline = "offline" in loaderData && loaderData.offline;
  const offlinePlaylists =
    "offline" in loaderData && Array.isArray(loaderData.offlinePlaylists)
      ? loaderData.offlinePlaylists
      : [];

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = parseSort(searchParams.get("sort"));
  const q = searchParams.get("q") ?? "";

  const initialPlaylists = loaderData.playlists;
  const initialPagination = loaderData.pagination;

  const fetcher = useFetcher<LoaderData>();
  const [items, setItems] = useState(initialPlaylists);
  const [pagination, setPagination] = useState(initialPagination);

  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the accumulated list whenever navigation re-runs the loader with a
  // fresh page 1 (sort/search change, or back/forward to a different query).
  useEffect(() => {
    setItems(initialPlaylists);
    setPagination(initialPagination);
  }, [initialPlaylists, initialPagination]);

  // Append the next page once the fetcher finishes (skip stale responses).
  useEffect(() => {
    const next = fetcher.data;
    if (!next || next.sort !== sort || next.q !== q) return;
    setItems((prev) => {
      const seen = new Set(prev.map((playlist) => playlist.id));
      return [...prev, ...next.playlists.filter((playlist) => !seen.has(playlist.id))];
    });
    setPagination(next.pagination);
  }, [fetcher.data, sort, q]);

  // Keep the search box in sync with the URL (e.g. back/forward navigation).
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  if (offline) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Playlists</h1>
          <p className="text-muted-foreground mt-2">
            Playlists with downloaded tracks, available offline.
          </p>
        </div>
        <OfflinePlaylistsIndexView playlists={offlinePlaylists} />
      </div>
    );
  }

  const isLoading = fetcher.state !== "idle";

  const handleLoadMore = () => {
    if (isLoading || !pagination.hasNext || !pagination.nextCursor) return;
    const params = new URLSearchParams({
      cursor: pagination.nextCursor,
      limit: String(pagination.limit),
      sort,
    });
    if (q) params.set("q", q);
    fetcher.load(`/playlists?${params.toString()}`);
  };

  const resetToFirstPage = (mutate: (params: URLSearchParams) => void) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        mutate(params);
        params.delete("cursor");
        params.delete("limit");
        return params;
      },
      { replace: true },
    );
  };

  const handleSortChange = (value: SortOption) => {
    resetToFirstPage((params) => params.set("sort", value));
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      resetToFirstPage((params) => {
        if (value.trim()) params.set("q", value.trim());
        else params.delete("q");
      });
    }, 300);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Playlists</h1>
          <p className="text-muted-foreground">
            {items.length} playlist{items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <NavLink
          to="new"
          className={({ isActive }) =>
            cn(
              "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors",
              isActive && "bg-primary/90",
            )
          }
        >
          <Icon name="plus" className="h-4 w-4" />
          Create Playlist
        </NavLink>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Icon
            name="magnifying-glass"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <Input
            placeholder="Search playlists..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Sort */}
        <Select value={sort} onValueChange={(value: SortOption) => handleSortChange(value)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently Updated</SelectItem>
            <SelectItem value="created">Recently Created</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="tracks">Track Count</SelectItem>
          </SelectContent>
        </Select>

        {/* View Toggle */}
        <div className="flex rounded-lg border p-1">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
            className="h-8 w-8 p-0"
          >
            <Icon name="dots-horizontal" className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="h-8 w-8 p-0"
          >
            <Icon name="list-bullet" className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icon name="file-text" className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {q ? "No playlists found" : "No playlists yet"}
          </h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            {q
              ? `No playlists match "${q}". Try a different search term.`
              : "Start organizing your music by creating your first playlist."}
          </p>
          {!q && (
            <NavLink
              to="new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Icon name="plus" className="h-5 w-5" />
              Create Your First Playlist
            </NavLink>
          )}
        </div>
      ) : (
        <>
          {/* Playlists Grid/List */}
          <div
            className={cn(
              "grid gap-6",
              viewMode === "grid"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1",
            )}
          >
            {items.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                id={playlist.id}
                title={playlist.title}
                description={playlist.description}
                tracks={playlist.tracks.map((pt) => pt.track)}
                createdAt={playlist.createdAt.toISOString()}
                updatedAt={playlist.updatedAt.toISOString()}
              />
            ))}
          </div>

          {/* Infinite scroll sentinel (replaces the "Load More" link) */}
          {(pagination.hasNext || isLoading) && (
            <InfiniteScrollSentinel
              enabled={pagination.hasNext && !isLoading}
              onIntersect={handleLoadMore}
              className="flex items-center justify-center py-8"
            >
              {isLoading ? (
                <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-sm text-muted-foreground">Scroll to load more</span>
              )}
            </InfiniteScrollSentinel>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Search results component for displaying unified search results
 * Mixed feed with Spotify-style metadata per type
 */

import { Link } from "react-router";
import { type SearchResult } from "#app/types/search.ts";
import { Icon } from "./ui/icon.tsx";

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  onLoadMore?: () => void;
  hasNext?: boolean;
  isLoading?: boolean;
}

function getTypeLabel(type: SearchResult["type"]): string {
  switch (type) {
    case "track":
      return "Track";
    case "album":
      return "Album";
    case "artist":
      return "Artist";
    case "playlist":
      return "Playlist";
  }
}

function getResultLink(result: SearchResult): string {
  switch (result.type) {
    case "track":
      return `/library/${result.id}`;
    case "album":
      return `/library?album=${result.id}`;
    case "artist":
      return `/library?artist=${result.id}`;
    case "playlist":
      return `/playlists/${result.id}`;
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function SearchResults({
  results,
  query,
  onLoadMore,
  hasNext = false,
  isLoading = false,
}: SearchResultsProps) {
  // Empty state — no query entered
  if (!query.trim() && results.length === 0) {
    return null;
  }

  // Loading state
  if (isLoading && results.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // No results
  if (results.length === 0 && !isLoading && query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Icon name="magnifying-glass" className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="mb-2 text-lg font-semibold">No results found</h3>
        <p className="text-muted-foreground">
          No tracks, albums, artists, or playlists match "{query}"
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {results.map((result) => (
        <Link
          key={`${result.type}-${result.id}`}
          to={getResultLink(result)}
          className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-muted/50"
        >
          {/* Type icon + cover thumbnail */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
            {result.type === "playlist" && result.thumbnailUrl ? (
              <img
                src={result.thumbnailUrl}
                alt=""
                className="h-12 w-12 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <Icon
                name={
                  result.type === "track"
                    ? "file-text"
                    : result.type === "album"
                      ? "file-text"
                      : result.type === "playlist"
                        ? "file-text"
                        : "file-text"
                }
                className="h-6 w-6 text-muted-foreground"
              />
            )}
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {result.type === "track"
                ? result.title
                : result.type === "playlist"
                  ? result.name
                  : result.type === "album"
                    ? result.name
                    : result.name}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {result.type === "track" && (
                <>
                  {result.artistName}
                  {result.albumName && ` • ${result.albumName}`}
                </>
              )}
              {result.type === "album" && (
                <>
                  {result.artistName}
                  {result.year && ` • ${result.year}`}
                </>
              )}
              {result.type === "artist" && <>{result.genre || "Artist"}</>}
              {result.type === "playlist" && (
                <>
                  {result.ownerName} • {result.itemCount} tracks
                </>
              )}
            </p>
          </div>

          {/* Right metadata */}
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5">{getTypeLabel(result.type)}</span>
            {result.type === "track" && (
              <div className="mt-1">{formatDuration(result.duration)}</div>
            )}
          </div>
        </Link>
      ))}

      {/* Load More Button */}
      {hasNext && onLoadMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {/* Loading spinner at bottom while loading more */}
      {isLoading && results.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}

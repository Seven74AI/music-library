/**
 * Search results — mixed feed with horizontal cards, sorted by relevance
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

function getResultLink(result: SearchResult): string {
  switch (result.type) {
    case "track":
      return `/library/${result.id}`;
    case "album":
      return `/albums/${result.id}`;
    case "artist":
      return `/artists/${result.id}`;
    case "playlist":
      return `/playlists/${result.id}`;
  }
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

function getResultSubtitle(result: SearchResult): string {
  switch (result.type) {
    case "track":
      return `Track — ${result.artistName}`;
    case "album":
      return `Album — ${result.artistName}${result.year ? ` · ${result.year}` : ""}`;
    case "artist":
      return result.genre ? `Artist · ${result.genre}` : "Artist";
    case "playlist":
      return `Playlist — ${result.trackCount} tracks`;
  }
}

function ResultImage({ result }: { result: SearchResult }) {
  const imageUrl =
    result.type === "playlist" ? result.thumbnailUrl : null;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-12 w-12 rounded object-cover"
        loading="lazy"
      />
    );
  }

  const iconName =
    result.type === "track"
      ? "play"
      : result.type === "album"
        ? "camera"
        : result.type === "artist"
          ? "avatar"
          : "list-bullet";

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
      <Icon name={iconName} className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

export function SearchResults({
  results,
  query,
  onLoadMore,
  hasNext = false,
  isLoading = false,
}: SearchResultsProps) {
  if (results.length === 0 && !isLoading && query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Icon
          name="magnifying-glass"
          className="mb-4 h-12 w-12 text-muted-foreground"
        />
        <h3 className="mb-2 text-lg font-semibold">No results found</h3>
        <p className="text-muted-foreground">
          No tracks, albums, artists, or playlists match "{query}"
        </p>
      </div>
    );
  }

  if (!query.trim() && results.length === 0) {
    return null;
  }

  // Results are already sorted by relevance from the API — display as mixed feed
  return (
    <div>
      {results.map((result) => (
        <Link
          key={`${result.type}-${result.id}`}
          to={getResultLink(result)}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
        >
          <ResultImage result={result} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {result.type === "track" ? result.title : result.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {getResultSubtitle(result)}
            </p>
          </div>
        </Link>
      ))}

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
    </div>
  );
}

/**
 * Search results — mixed feed with horizontal cards, sorted by relevance
 */

import { Link } from "react-router";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { type SearchResult, type TrackSearchResult } from "#app/types/search.ts";
import { mapSearchTrackToListItem } from "#app/utils/map-search-track.ts";
import { Icon } from "./ui/icon.tsx";

interface SearchPlaylist {
  id: string;
  title: string;
  description: string | null;
  _count: { tracks: number };
}

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  onLoadMore?: () => void;
  hasNext?: boolean;
  isLoading?: boolean;
  playlists?: SearchPlaylist[];
}

/** Per-entity configuration — single source of truth for links, icons, subtitles */
const ENTITY_CONFIG: Record<
  Exclude<SearchResult["type"], "track">,
  {
    link: (id: string) => string;
    icon: Parameters<typeof Icon>[0]["name"];
    subtitle: (r: SearchResult) => string;
  }
> = {
  album: {
    link: (id) => `/albums/${id}`,
    icon: "camera",
    subtitle: (r) =>
      r.type === "album" ? `Album — ${r.artistName}${r.year ? ` · ${r.year}` : ""}` : "Album",
  },
  artist: {
    link: (id) => `/artists/${id}`,
    icon: "avatar",
    subtitle: (r) => (r.type === "artist" && r.genre ? `Artist · ${r.genre}` : "Artist"),
  },
  playlist: {
    link: (id) => `/playlists/${id}`,
    icon: "list-bullet",
    subtitle: (r) => (r.type === "playlist" ? `Playlist — ${r.trackCount} tracks` : "Playlist"),
  },
};

function ResultImage({ result }: { result: Exclude<SearchResult, TrackSearchResult> }) {
  const config = ENTITY_CONFIG[result.type];
  const imageUrl = result.type === "playlist" ? result.thumbnailUrl : null;

  if (imageUrl) {
    return <img src={imageUrl} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" />;
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
      <Icon name={config.icon} className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

function EntityResultRow({ result }: { result: Exclude<SearchResult, TrackSearchResult> }) {
  const config = ENTITY_CONFIG[result.type];

  return (
    <Link
      to={config.link(result.id)}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      <ResultImage result={result} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{result.name}</p>
        <p className="truncate text-xs text-muted-foreground">{config.subtitle(result)}</p>
      </div>
    </Link>
  );
}

export function SearchResults({
  results,
  query,
  onLoadMore,
  hasNext = false,
  isLoading = false,
  playlists = [],
}: SearchResultsProps) {
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

  if (!query.trim() && results.length === 0) {
    return null;
  }

  let trackIndex = 0;

  return (
    <div>
      {results.map((result) => {
        if (result.type === "track") {
          const currentTrackIndex = trackIndex;
          trackIndex += 1;

          return (
            <TrackListItem
              key={`track-${result.id}`}
              track={mapSearchTrackToListItem(result)}
              userTrack={{ createdAt: result.addedAt ?? new Date(0).toISOString() }}
              index={currentTrackIndex}
              playlists={playlists}
              variant="compact"
              showQuickAddToPlaylist
              usePlaybackIndex={false}
              playlistContext={{ type: "track", trackId: result.id }}
              showDuration
            />
          );
        }

        return <EntityResultRow key={`${result.type}-${result.id}`} result={result} />;
      })}

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

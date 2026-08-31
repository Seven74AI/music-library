import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { data } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import {
  getPlayHistory,
  parseHistoryCursor,
  type PlayHistoryTrack,
} from "#app/features/play-history/play-history.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { formatRelativeTime } from "#app/utils/format-relative-time.ts";
import { isPlayableTrack } from "#app/utils/playable-track";
import { type Route } from "./+types/history.ts";

export type HistoryItem = {
  id: string;
  playId: string | null;
  completed: boolean;
  playedAt: string | Date;
  track: PlayHistoryTrack;
};

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const cursor = parseHistoryCursor(url.searchParams.get("cursor"));
  const { items, nextCursor } = await getPlayHistory({ userId, cursor });
  return data({ items, nextCursor });
}

function formatPlayedAt(playedAt: string | Date): string {
  return new Date(playedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const { playTrack, currentTrack } = useAudioPlayer();
  const track = item.track;
  const playable = isPlayableTrack({ audioFiles: track.audioFiles });
  const isCurrent = currentTrack?.id === track.id;

  const handlePlay = () => {
    if (!playable) return;
    playTrack(track, { type: "track", trackId: track.id });
  };

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <Button
        variant="ghost"
        size="sm"
        className="h-10 w-10 shrink-0 p-0"
        aria-label={playable ? `Play ${track.title}` : `${track.title} is not playable`}
        disabled={!playable}
        onClick={handlePlay}
      >
        <Icon name={isCurrent ? "pause" : "play"} className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <TrackThumbnail coverImage={track.coverImage} alt={track.title} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{track.title}</div>
            <div className="truncate text-xs text-muted-foreground">{track.artist.name}</div>
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={
              item.completed ? "font-medium text-emerald-600 dark:text-emerald-400" : undefined
            }
          >
            {item.completed ? "Completed" : "Skipped"}
          </span>
          <span aria-hidden="true">-</span>
          <time
            dateTime={new Date(item.playedAt).toISOString()}
            title={formatPlayedAt(item.playedAt)}
          >
            {formatRelativeTime(item.playedAt)}
          </time>
        </div>
      </div>

      <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </div>
    </li>
  );
}

export default function HistoryPage({ loaderData }: Route.ComponentProps) {
  // `loaderData` may be an offline stub (`{}`) when the offline middleware
  // patches this route, so default to empty instead of crashing.
  const initialItems = (loaderData.items ?? []) as HistoryItem[];
  const initialNextCursor = loaderData.nextCursor ?? null;
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data: queryData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
  } = useInfiniteQuery({
    queryKey: ["play-history"],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/history?${params}`);
      if (!res.ok) throw new Error("Failed to load history");
      return (await res.json()) as { items: HistoryItem[]; nextCursor: string | null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    initialPageParam: undefined as string | undefined,
    initialData: {
      pages: [{ items: initialItems as HistoryItem[], nextCursor: initialNextCursor }],
      pageParams: [undefined],
    },
  });

  const items = queryData?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  return (
    <div className="py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Play History</h1>
        <p className="text-muted-foreground mt-2">
          Tracks you've recently played, most recent first.
        </p>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icon name="clock" className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No play history yet</h3>
          <p className="text-muted-foreground">Tracks you play will show up here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border">
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      <div
        ref={loadMoreRef}
        className="flex h-16 items-center justify-center text-sm text-muted-foreground"
      >
        {isFetchingNextPage ? (
          <Icon name="update" className="h-5 w-5 animate-spin" />
        ) : hasNextPage ? (
          "Scroll to load more"
        ) : items.length > 0 ? (
          "You're all caught up"
        ) : null}
      </div>
    </div>
  );
}

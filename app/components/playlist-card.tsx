import { useState } from "react";
import { NavLink } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";
import { useIsMobile } from "#app/utils/use-mobile.ts";
import { PlaylistCover } from "./playlist-cover";

interface PlaylistCardTrack {
  id: string;
  title: string;
  artist: { id: string; name: string };
  duration: number | null;
  coverImage: { objectKey: string } | null;
}

interface PlaylistCardProps {
  id: string;
  title: string;
  description: string | null;
  tracks: PlaylistCardTrack[];
  /** Full playlist track count when `tracks` is a cover preview subset */
  trackCount?: number;
  /** Kept for callers that still compute duration; no longer shown in the card */
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
  to?: string;
  /** `list` = Spotify-style row (default). `grid` = slim cover tile. */
  variant?: "list" | "grid";
  className?: string;
}

export function PlaylistCard({
  id,
  title,
  description,
  tracks,
  trackCount,
  totalDuration: _totalDuration,
  createdAt: _createdAt,
  updatedAt,
  to,
  variant = "list",
  className,
}: PlaylistCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isMobile = useIsMobile();
  const { playUserPlaylist } = useAudioPlayer();

  const displayTrackCount = trackCount ?? tracks.length;
  const trackLabel = `${displayTrackCount} track${displayTrackCount !== 1 ? "s" : ""}`;
  const updatedLabel = `Updated ${new Date(updatedAt).toLocaleDateString()}`;
  const metaLabel = `${trackLabel} · ${updatedLabel}`;
  const canPlay = tracks.length > 0;
  const showPlay = canPlay && (isHovered || isMobile);

  const playButton = canPlay ? (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-200",
        showPlay ? "opacity-100" : "opacity-0",
      )}
    >
      <Button
        variant="secondary"
        size="icon"
        className={cn(
          "rounded-full shadow-lg transition-transform duration-200 hover:scale-110",
          variant === "list" ? "h-8 w-8" : "h-10 w-10",
        )}
        aria-label={`Play ${title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void playUserPlaylist(id);
        }}
      >
        <Icon
          name="play"
          className={cn(
            "ml-0.5 text-secondary-foreground",
            variant === "list" ? "h-3.5 w-3.5" : "h-5 w-5",
          )}
        />
      </Button>
    </div>
  ) : null;

  const textBlock = (
    <div className={cn("min-w-0", variant === "list" ? "flex-1" : "space-y-0.5")}>
      <h3
        className={cn(
          "truncate font-semibold text-foreground group-hover:text-primary transition-colors",
          variant === "list" ? "text-sm sm:text-base" : "text-sm",
        )}
      >
        {title}
      </h3>
      <p className="truncate text-xs text-muted-foreground sm:text-sm">{metaLabel}</p>
      {description ? (
        <p
          className={cn(
            "text-xs text-muted-foreground line-clamp-3",
            variant === "list" ? "mt-0.5" : "mt-1",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );

  return (
    <NavLink
      to={to ?? id}
      preventScrollReset
      prefetch="intent"
      data-testid="playlist-card"
      data-variant={variant}
      className={({ isActive }) =>
        cn(
          "group block rounded-md transition-colors",
          variant === "list"
            ? "flex items-center gap-3 px-2 py-2 hover:bg-accent/60"
            : "space-y-2 p-1 hover:bg-accent/40",
          isActive && "bg-accent/80",
          className,
        )
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {variant === "list" ? (
        <>
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md sm:h-16 sm:w-16">
            <PlaylistCover tracks={tracks} size="sm" className="h-full w-full rounded-md" />
            {playButton}
          </div>
          {textBlock}
        </>
      ) : (
        <>
          <div className="relative aspect-square w-full overflow-hidden rounded-md">
            <PlaylistCover tracks={tracks} size="lg" className="h-full w-full rounded-md" />
            {playButton}
          </div>
          {textBlock}
        </>
      )}
    </NavLink>
  );
}

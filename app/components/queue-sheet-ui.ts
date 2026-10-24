import { type PlaylistContext } from "./audio-player-play-context";

export function getSpineSectionLabel(playContext: PlaylistContext | null): string {
  if (playContext?.type === "playlist") return "from playlist";
  if (playContext?.type === "library") return "from library";
  if (playContext?.type === "artist") return "from artist";
  if (playContext?.type === "album") return "from album";
  if (playContext?.type === "track") return "from track";
  if (playContext?.type === "onRepeatSnapshot") return "from on-repeat";
  if (playContext?.type === "discover") return "from discover";
  return "from queue";
}

export function formatQueueSheetTitle(
  upNextCount: number,
  spineTotal: number,
  spineLabel: string,
): string {
  const parts: string[] = [];

  if (upNextCount > 0) {
    parts.push(`${upNextCount.toLocaleString()} up next`);
  }

  if (spineTotal > 0) {
    parts.push(`${spineTotal.toLocaleString()} ${spineLabel}`);
  }

  if (parts.length === 0) return "Queue";
  return `Queue (${parts.join(" · ")})`;
}

export function getSpineSectionHeading(playContext: PlaylistContext | null): string {
  if (playContext?.type === "playlist") return "From Playlist";
  if (playContext?.type === "library") return "From Library";
  if (playContext?.type === "artist") return "From Artist";
  if (playContext?.type === "album") return "From Album";
  if (playContext?.type === "track") return "From Track";
  if (playContext?.type === "onRepeatSnapshot") return "From On-Repeat";
  if (playContext?.type === "discover") return "From Discover";
  return "From Queue";
}

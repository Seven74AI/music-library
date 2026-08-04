type PlayContext = {
  type: "library" | "playlist" | "artist" | "album" | "track" | "music";
  playlistId?: string;
} | null;

export function getSpineSectionLabel(playContext: PlayContext): string {
  if (playContext?.type === "playlist") return "from playlist";
  if (playContext?.type === "library") return "from library";
  if (playContext?.type === "artist") return "from artist";
  if (playContext?.type === "album") return "from album";
  if (playContext?.type === "track") return "from track";
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

export function getSpineSectionHeading(playContext: PlayContext): string {
  if (playContext?.type === "playlist") return "From Playlist";
  if (playContext?.type === "library") return "From Library";
  if (playContext?.type === "artist") return "From Artist";
  if (playContext?.type === "album") return "From Album";
  if (playContext?.type === "track") return "From Track";
  return "From Queue";
}

import { Icon } from "#app/components/ui/icon";

export type PlaybackSource = "stream" | "cache" | "downloaded";

export type PlaybackSourceInfo = {
  source: PlaybackSource;
  hasDownloadedCopy: boolean;
  recoveredFromMediaError: boolean;
};

export function getPlaybackSource(options: {
  audioSrc: string | undefined;
  isPinnedDownload: boolean;
  recoveredFromMediaError?: boolean;
}): PlaybackSourceInfo | null {
  const { audioSrc, isPinnedDownload, recoveredFromMediaError = false } = options;
  if (!audioSrc) return null;

  const isLocal = audioSrc.startsWith("blob:");
  let source: PlaybackSource;
  if (isLocal) {
    source = isPinnedDownload ? "downloaded" : "cache";
  } else {
    source = "stream";
  }

  return {
    source,
    hasDownloadedCopy: !isLocal && isPinnedDownload,
    recoveredFromMediaError,
  };
}

function getSourceLabels(info: PlaybackSourceInfo): { ariaLabel: string; title: string } {
  const { source, hasDownloadedCopy, recoveredFromMediaError } = info;

  if (source === "cache") {
    return { ariaLabel: "Playing from cache", title: "Playing from cache" };
  }
  if (source === "downloaded") {
    return { ariaLabel: "Playing downloaded copy", title: "Playing downloaded copy" };
  }

  if (recoveredFromMediaError) {
    return {
      ariaLabel: "Streaming",
      title: "Playback recovered to streaming after a media error (downloaded copy failed)",
    };
  }

  if (hasDownloadedCopy) {
    return {
      ariaLabel: "Streaming",
      title: "Streaming (downloaded copy available)",
    };
  }

  return { ariaLabel: "Streaming", title: "Streaming" };
}

const SOURCE_ICON: Record<PlaybackSource, "globe" | "laptop" | "check-circled"> = {
  stream: "globe",
  cache: "laptop",
  downloaded: "check-circled",
};

export function PlaybackSourceIndicator(info: PlaybackSourceInfo) {
  const { source } = info;
  const { ariaLabel, title } = getSourceLabels(info);

  return (
    <span
      role="img"
      data-testid="player-source-indicator"
      data-source={source}
      aria-label={ariaLabel}
      title={title}
    >
      <Icon
        name={SOURCE_ICON[source]}
        className="h-4 w-4 shrink-0 text-muted-foreground"
        title={title}
      />
    </span>
  );
}
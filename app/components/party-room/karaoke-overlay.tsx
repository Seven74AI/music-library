import { useEffect, useRef, useState } from "react";
import { selectKaraokeView, type KaraokeView } from "#app/features/track-video/karaoke-active.ts";
import { type KaraokeLines } from "#app/features/track-video/karaoke-lines.ts";
import { cn } from "#app/utils/misc.tsx";

/** Re-seek the muted video only when it drifts further than this from the audio clock. */
const VIDEO_DRIFT_SECONDS = 0.3;

type KaraokeSnapshot = { trackId: string; lines: KaraokeLines; videoSrc: string };

function viewKey(view: KaraokeView): string {
  return `${view.currentLineIndex}|${view.activeWordIndex}|${view.sungWordCount}|${view.visible
    .map((l) => l.index)
    .join(",")}`;
}

/**
 * Host-device karaoke overlay: muted fullscreen video + word-highlighted lyrics.
 *
 * The track's `<audio>` element is the only clock. Its `currentTime` is read on
 * a requestAnimationFrame loop (sub-100ms), and this component never controls
 * audio playback. `lines` and the video URL are snapshotted once per
 * `startKey` (one per track start) so a mid-song version repoint cannot swap
 * words or video.
 */
export function KaraokeOverlay({
  trackId,
  startKey,
  hasReady,
  getAudioElement,
}: {
  trackId: string;
  /** Changes on every track start (room id + track + queue index). */
  startKey: string;
  hasReady: boolean;
  getAudioElement: () => HTMLAudioElement | null;
}) {
  const [snapshot, setSnapshot] = useState<KaraokeSnapshot | null>(null);
  const [view, setView] = useState<KaraokeView | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const getAudioElementRef = useRef(getAudioElement);
  getAudioElementRef.current = getAudioElement;

  // One snapshot per track start.
  useEffect(() => {
    setSnapshot(null);
    setView(null);
    if (!hasReady) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/resources/rooms/karaoke/${trackId}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { lines?: KaraokeLines };
        if (controller.signal.aborted || !Array.isArray(data.lines)) return;
        setSnapshot({
          trackId,
          lines: data.lines,
          videoSrc: `/resources/rooms/video/${trackId}`,
        });
      } catch {
        // Fall back to the audio-only player bar.
      }
    })();
    return () => controller.abort();
  }, [trackId, startKey, hasReady]);

  // rAF loop over the audio element's currentTime.
  useEffect(() => {
    if (!snapshot) return;
    let frame = 0;
    let lastKey = "";
    const loop = () => {
      const audio = getAudioElementRef.current();
      if (audio) {
        const t = audio.currentTime;
        const next = selectKaraokeView(snapshot.lines, t);
        const key = viewKey(next);
        if (key !== lastKey) {
          lastKey = key;
          setView(next);
        }
        syncVideo(videoRef.current, audio, t);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [snapshot]);

  if (!hasReady || !snapshot) return null;

  const lines = snapshot.lines;
  return (
    <div
      data-testid="karaoke-overlay"
      // Below the player chrome (z-50) so the host keeps play/pause/skip.
      className="fixed inset-0 z-40 bg-black"
    >
      <video
        ref={videoRef}
        data-testid="karaoke-video"
        src={snapshot.videoSrc}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex min-h-1/2 flex-col justify-end gap-3 bg-linear-to-t from-black/85 via-black/50 to-transparent px-6 pb-40 text-center">
        {view?.visible.map((entry) => {
          const line = lines[entry.index] ?? [];
          const isCurrent = entry.state === "current";
          return (
            <p
              key={entry.index}
              data-testid="karaoke-line"
              data-line-state={entry.state}
              className={cn(
                "min-h-[1.5em] font-semibold text-white transition-opacity duration-300",
                isCurrent ? "text-4xl md:text-6xl" : "text-2xl opacity-60 md:text-4xl",
              )}
            >
              {line.map((word, i) => {
                const state = !isCurrent
                  ? "upcoming"
                  : i === view.activeWordIndex
                    ? "active"
                    : i < view.sungWordCount
                      ? "sung"
                      : "upcoming";
                return (
                  <span
                    key={i}
                    data-word-state={state}
                    className={cn(
                      "mr-[0.25em] inline-block transition-colors duration-100",
                      state === "active" && "text-yellow-300",
                      state === "sung" && "text-white",
                      state === "upcoming" && isCurrent && "text-white/60",
                    )}
                  >
                    {word.word}
                  </span>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}

/** Keep the muted video following the audio clock; never touches the audio. */
function syncVideo(video: HTMLVideoElement | null, audio: HTMLAudioElement, t: number) {
  if (!video) return;
  if (Math.abs(video.currentTime - t) > VIDEO_DRIFT_SECONDS) {
    try {
      video.currentTime = t;
    } catch {
      // Metadata not loaded yet; next frame retries.
    }
  }
  if (audio.paused) {
    if (!video.paused) video.pause();
  } else if (video.paused) {
    void video.play()?.catch(() => {});
  }
}

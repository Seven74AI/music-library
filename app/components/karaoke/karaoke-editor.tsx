import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { Textarea } from "#app/components/ui/textarea.tsx";
import { resolveTrackPlaybackSource } from "#app/features/offline-storage/resolve-playback-url.client.ts";
import { computePeaks } from "#app/features/track-video/audio-peaks.client.ts";
import { selectKaraokeView } from "#app/features/track-video/karaoke-active.ts";
import { linesToText, setWordTime } from "#app/features/track-video/karaoke-edit.ts";
import {
  validateKaraokeLines,
  type KaraokeLines,
} from "#app/features/track-video/karaoke-lines.ts";
import { errorMessage, postForm } from "./karaoke-api.ts";
import { KaraokeLineList } from "./karaoke-line-list.tsx";
import { KaraokeWaveform, type FlatWord } from "./karaoke-waveform.tsx";

export type KaraokeEditorVersion = {
  id: string;
  status: string;
  language: string;
  source: string;
  lyricsText: string;
  lines: KaraokeLines;
  /** Generation job status; null for versions without a job (manual edits). */
  jobStatus: string | null;
};

export type KaraokeVersionSummary = {
  id: string;
  status: string;
  createdAt: string;
  language: string;
  source: string;
  createdBy: string | null;
};

const VIDEO_DRIFT_SECONDS = 0.3;

/** Keep the muted preview video within drift of the audio clock; never touches audio. */
function syncVideo(video: HTMLVideoElement | null, audio: HTMLAudioElement, t: number) {
  if (!video) return;
  // Video shorter than the audio: hold the last frame.
  if (video.ended || (Number.isFinite(video.duration) && t >= video.duration)) {
    if (!video.paused) video.pause();
    return;
  }
  if (Math.abs(video.currentTime - t) > VIDEO_DRIFT_SECONDS) {
    try {
      video.currentTime = t;
    } catch {
      // Metadata not loaded yet.
    }
  }
  if (audio.paused) {
    if (!video.paused) video.pause();
  } else if (video.paused) {
    void video.play?.()?.catch(() => {});
  }
}

function validationMessage(lines: KaraokeLines): string | null {
  const result = validateKaraokeLines(lines);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const [l, w] = issue.path;
  const where =
    typeof l === "number" ? `Line ${l + 1}${typeof w === "number" ? `, word ${w + 1}` : ""}: ` : "";
  return where + issue.message;
}

export function KaraokeEditor({
  trackId,
  version,
  versions,
  currentVersionId,
}: {
  trackId: string;
  version: KaraokeEditorVersion;
  versions: KaraokeVersionSummary[];
  currentVersionId: string | null;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<KaraokeLines>(version.lines);
  const [text, setText] = useState(version.lyricsText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ l: number; w: number } | null>(null);
  const [peaks, setPeaks] = useState<number[]>([0.5]);
  const [duration, setDuration] = useState(0);
  const [videoOk, setVideoOk] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    setAudioSrc(null);
    setAudioError(null);
    resolveTrackPlaybackSource(trackId)
      .then((url) => {
        if (cancelled) return;
        if (url) setAudioSrc(url);
        else
          setAudioError(
            "Could not load audio for preview. You may not have access to this track's audio.",
          );
      })
      .catch(() => {
        if (!cancelled) setAudioError("Could not load audio for preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // Client-side waveform peaks; fall back to a flat line on any failure.
  useEffect(() => {
    let cancelled = false;
    setPeaks([0.5]);
    computePeaks(`/resources/audio/${trackId}?stream=1`)
      .then((p) => {
        if (!cancelled && p.length > 0) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) setPeaks([0.5]);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const flatWords = useMemo<FlatWord[]>(
    () =>
      lines.flatMap((line, l) =>
        line.map((word, w) => ({
          l,
          w,
          word: word.word,
          start: word.start,
          end: word.end,
        })),
      ),
    [lines],
  );

  const generating =
    version.jobStatus !== null &&
    version.jobStatus !== "completed" &&
    version.jobStatus !== "failed";
  const dirty = useMemo(
    () => JSON.stringify(lines) !== JSON.stringify(version.lines),
    [lines, version.lines],
  );
  const versionPath = (id: string) => `/library/${trackId}/karaoke/${id}`;
  const apply = (next: KaraokeLines) => {
    setLines(next);
    setNotice(null);
  };

  function seek(t: number) {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
    setPlayhead(t);
    if (audio) syncVideo(videoRef.current, audio, t);
  }

  async function run(
    url: string,
    params: Record<string, string>,
    fallback: string,
    onOk: (json: any) => void,
  ) {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { ok, json } = await postForm(url, params);
    setBusy(false);
    if (ok) onOk(json);
    else setError(errorMessage(json, fallback));
  }

  function save() {
    const problem = validationMessage(lines);
    if (problem) {
      setError(problem);
      return;
    }
    void run(
      "/resources/karaoke/save-edit",
      {
        versionId: version.id,
        text: linesToText(lines),
        lines: JSON.stringify(lines),
      },
      "Could not save",
      (json) => navigate(versionPath(json.versionId)),
    );
  }

  const view = playhead === null ? null : selectKaraokeView(lines, playhead);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          Version {version.id} · {version.status} · {version.language} · {version.source}
        </span>
        <Button type="button" disabled={busy || generating} onClick={save}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || generating || dirty || lines.length === 0}
          title={dirty ? "Save your changes first" : undefined}
          onClick={() =>
            void run(
              "/resources/karaoke/mark-ready",
              { versionId: version.id },
              "Could not mark ready",
              () => {
                setNotice("Marked ready");
                navigate(versionPath(version.id));
              },
            )
          }
        >
          Mark ready
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {generating ? (
        <p role="status" className="text-sm font-medium">
          Generating word timings… this page will update when it finishes.
        </p>
      ) : null}
      {version.jobStatus === "failed" ? (
        <p role="status" className="text-destructive text-sm">
          Generation failed. Edit the text and re-align, or re-transcribe.
        </p>
      ) : null}

      <section aria-label="Preview" className="space-y-2">
        <h2 className="text-lg font-medium">Preview</h2>
        {audioError ? (
          <p role="alert" className="text-destructive text-sm">
            {audioError}
          </p>
        ) : null}
        {videoOk ? (
          <video
            ref={videoRef}
            src={`/resources/video/${trackId}`}
            muted
            playsInline
            preload="metadata"
            className="max-h-80 w-full rounded bg-black"
            onError={() => setVideoOk(false)}
          />
        ) : null}
        {view && view.visible.length > 0 ? (
          <div data-testid="preview-lines" className="space-y-1 text-lg">
            {view.visible.map(({ index, state }) => (
              <p key={index} className={state === "current" ? "font-semibold" : "opacity-60"}>
                {lines[index]!.map((w, wi) => (
                  <span
                    key={wi}
                    className={
                      state === "current" && wi === view.activeWordIndex
                        ? "bg-primary text-primary-foreground mr-1 rounded px-0.5"
                        : "mr-1"
                    }
                  >
                    {w.word}
                  </span>
                ))}
              </p>
            ))}
          </div>
        ) : null}
        <audio
          ref={audioRef}
          controls
          src={audioSrc ?? undefined}
          className="w-full"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setPlayhead(t);
            syncVideo(videoRef.current, e.currentTarget, t);
          }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            setDuration(Number.isFinite(d) ? d : 0);
          }}
          onError={() => {
            if (audioSrc) setAudioError("Audio failed to load. You may not have access to it.");
          }}
        />
      </section>

      {!generating ? (
        <section aria-label="Lines" className="space-y-3">
          <h2 className="text-lg font-medium">Lines</h2>
          <KaraokeWaveform
            peaks={peaks}
            duration={duration}
            currentTime={playhead ?? 0}
            words={flatWords}
            selected={selected}
            onSeek={seek}
            onWordTimeChange={(l, w, field, t) => {
              // Functional update: a drag may emit several changes per frame.
              setLines((prev) => setWordTime(prev, l, w, field, t));
              setNotice(null);
            }}
          />
          <KaraokeLineList
            lines={lines}
            selected={selected}
            disabled={busy}
            onSelect={(l, w) => {
              setSelected({ l, w });
              const word = lines[l]?.[w];
              if (word) seek(word.start);
            }}
            onEdit={apply}
          />
        </section>
      ) : null}

      <section aria-label="Re-align" className="space-y-2">
        <h2 className="text-lg font-medium">Re-align</h2>
        <p className="text-muted-foreground text-sm">
          Regenerates all word timings from the text below as a new draft. Edits above are not
          carried over.
        </p>
        <Label htmlFor="karaoke-realign-text">Lyrics text</Label>
        <Textarea
          id="karaoke-realign-text"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || generating || !text.trim()}
            onClick={() =>
              void run(
                "/resources/karaoke/re-align",
                { versionId: version.id, text },
                "Could not re-align",
                (json) => navigate(versionPath(json.versionId)),
              )
            }
          >
            Re-align
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || generating}
            onClick={() =>
              void run(
                "/resources/karaoke/re-align",
                { versionId: version.id, text: "" },
                "Could not re-transcribe",
                (json) => navigate(versionPath(json.versionId)),
              )
            }
          >
            Re-transcribe
          </Button>
        </div>
      </section>

      <section aria-label="Version history" className="space-y-2">
        <h2 className="text-lg font-medium">Version history</h2>
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link className="underline" to={versionPath(v.id)}>
                {new Date(v.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </Link>
              <span>
                {v.status} · {v.language} · {v.source}
              </span>
              {v.id === currentVersionId ? (
                <span className="font-semibold">Current</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Restore ${v.id}`}
                  disabled={busy || generating}
                  onClick={() =>
                    void run(
                      "/resources/karaoke/restore",
                      { versionId: v.id },
                      "Could not restore",
                      () => {
                        setNotice("Restored");
                        navigate(versionPath(version.id));
                      },
                    )
                  }
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

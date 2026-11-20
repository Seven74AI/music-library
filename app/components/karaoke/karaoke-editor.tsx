import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { Textarea } from "#app/components/ui/textarea.tsx";
import { resolveTrackPlaybackSource } from "#app/features/offline-storage/resolve-playback-url.client.ts";
import { selectKaraokeView } from "#app/features/track-video/karaoke-active.ts";
import {
  addLine,
  addWord,
  deleteWord,
  editWordText,
  linesToText,
  mergeWithNext,
  moveWordToLine,
  nudgeWord,
  removeLine,
  setWordTime,
  splitLine,
} from "#app/features/track-video/karaoke-edit.ts";
import {
  validateKaraokeLines,
  type KaraokeLines,
} from "#app/features/track-video/karaoke-lines.ts";
import { errorMessage, postForm } from "./karaoke-api.ts";

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

const NUDGE = 0.05;

/** Number input that commits on blur / Enter and re-syncs from props. */
function TimeInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync the displayed value whenever the stored value changes.
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = () => {
    const n = Number.parseFloat(text);
    if (Number.isFinite(n)) {
      if (n !== value) onCommit(n);
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      aria-label={label}
      type="number"
      step="0.01"
      min="0"
      className="border-input bg-background w-20 rounded border px-1 py-0.5 text-sm"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 px-1.5 text-xs"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function validationMessage(lines: KaraokeLines): string | null {
  const result = validateKaraokeLines(lines);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const [l, w] = issue.path;
  const where =
    typeof l === "number"
      ? `Line ${l + 1}${typeof w === "number" ? `, word ${w + 1}` : ""}: `
      : "";
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
          Version {version.id} · {version.status} · {version.language} ·{" "}
          {version.source}
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
        <audio
          controls
          src={audioSrc ?? undefined}
          className="w-full"
          onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
          onError={() => {
            if (audioSrc)
              setAudioError(
                "Audio failed to load. You may not have access to it.",
              );
          }}
        />
        {view && view.visible.length > 0 ? (
          <div data-testid="preview-lines" className="space-y-1 text-lg">
            {view.visible.map(({ index, state }) => (
              <p
                key={index}
                className={state === "current" ? "font-semibold" : "opacity-60"}
              >
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
      </section>

      {!generating ? (
        <section aria-label="Lines" className="space-y-3">
          <h2 className="text-lg font-medium">Lines</h2>
          {lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">No lines yet.</p>
          ) : null}
          {lines.map((line, l) => {
            const n = l + 1;
            return (
              <div key={l} className="rounded border p-2">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="font-medium">Line {n}</span>
                  <IconButton
                    label={`Add line after ${n}`}
                    onClick={() => apply(addLine(lines, l))}
                  >
                    + line
                  </IconButton>
                  {line.length === 0 ? (
                    <IconButton
                      label={`Remove line ${n}`}
                      onClick={() => apply(removeLine(lines, l))}
                    >
                      Remove line
                    </IconButton>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {line.map((word, w) => {
                    const id = `${n}.${w + 1}`;
                    return (
                      <div key={w} className="space-y-1 rounded border p-1.5">
                        <input
                          aria-label={`Word ${id}`}
                          className="border-input bg-background w-full rounded border px-1 py-0.5 text-sm font-medium"
                          value={word.word}
                          onChange={(e) =>
                            apply(editWordText(lines, l, w, e.target.value))
                          }
                        />
                        <div className="flex items-center gap-1">
                          <IconButton
                            label={`Start earlier ${id}`}
                            onClick={() =>
                              apply(nudgeWord(lines, l, w, "start", -NUDGE))
                            }
                          >
                            ◂
                          </IconButton>
                          <TimeInput
                            label={`Start ${id}`}
                            value={word.start}
                            onCommit={(v) =>
                              apply(setWordTime(lines, l, w, "start", v))
                            }
                          />
                          <IconButton
                            label={`Start later ${id}`}
                            onClick={() =>
                              apply(nudgeWord(lines, l, w, "start", NUDGE))
                            }
                          >
                            ▸
                          </IconButton>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton
                            label={`End earlier ${id}`}
                            onClick={() =>
                              apply(nudgeWord(lines, l, w, "end", -NUDGE))
                            }
                          >
                            ◂
                          </IconButton>
                          <TimeInput
                            label={`End ${id}`}
                            value={word.end}
                            onCommit={(v) =>
                              apply(setWordTime(lines, l, w, "end", v))
                            }
                          />
                          <IconButton
                            label={`End later ${id}`}
                            onClick={() =>
                              apply(nudgeWord(lines, l, w, "end", NUDGE))
                            }
                          >
                            ▸
                          </IconButton>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <IconButton
                            label={`Add word before ${id}`}
                            onClick={() =>
                              apply(addWord(lines, l, w, "before"))
                            }
                          >
                            +←
                          </IconButton>
                          <IconButton
                            label={`Add word after ${id}`}
                            onClick={() => apply(addWord(lines, l, w, "after"))}
                          >
                            +→
                          </IconButton>
                          <IconButton
                            label={`Merge with next ${id}`}
                            disabled={w === line.length - 1}
                            onClick={() => apply(mergeWithNext(lines, l, w))}
                          >
                            Merge
                          </IconButton>
                          <IconButton
                            label={`Delete word ${id}`}
                            onClick={() => apply(deleteWord(lines, l, w))}
                          >
                            Del
                          </IconButton>
                          <IconButton
                            label={`Break line before ${id}`}
                            disabled={w === 0}
                            onClick={() => apply(splitLine(lines, l, w))}
                          >
                            ⏎
                          </IconButton>
                          <IconButton
                            label={`Move to previous line ${id}`}
                            disabled={w !== 0 || l === 0}
                            onClick={() =>
                              apply(moveWordToLine(lines, l, w, "prev"))
                            }
                          >
                            ↑
                          </IconButton>
                          <IconButton
                            label={`Move to next line ${id}`}
                            disabled={
                              w !== line.length - 1 || l === lines.length - 1
                            }
                            onClick={() =>
                              apply(moveWordToLine(lines, l, w, "next"))
                            }
                          >
                            ↓
                          </IconButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <section aria-label="Re-align" className="space-y-2">
        <h2 className="text-lg font-medium">Re-align</h2>
        <p className="text-muted-foreground text-sm">
          Regenerates all word timings from the text below as a new draft. Edits
          above are not carried over.
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
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <Link className="underline" to={versionPath(v.id)}>
                {new Date(v.createdAt)
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " ")}
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

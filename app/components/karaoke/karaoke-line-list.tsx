import { useEffect, useState } from "react";
import { Button } from "#app/components/ui/button.tsx";
import {
  addLine,
  addWord,
  deleteWord,
  editWordText,
  mergeWithNext,
  moveWordToLine,
  nudgeWord,
  removeLine,
  setWordTime,
  splitLine,
} from "#app/features/track-video/karaoke-edit.ts";
import { type KaraokeLines } from "#app/features/track-video/karaoke-lines.ts";

const NUDGE = 0.05;

export function formatTime(t: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

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

export function KaraokeLineList({
  lines,
  selected,
  onSelect,
  onEdit,
  disabled,
}: {
  lines: KaraokeLines;
  selected: { l: number; w: number } | null;
  onSelect: (l: number, w: number) => void;
  onEdit: (next: KaraokeLines) => void;
  disabled?: boolean;
}) {
  const sel = selected && lines[selected.l]?.[selected.w] ? selected : null;

  function renderEditor(l: number, w: number) {
    const line = lines[l]!;
    const word = line[w]!;
    const id = `${l + 1}.${w + 1}`;
    return (
      <div
        data-testid="selected-word-editor"
        className="bg-muted/40 mt-2 flex flex-wrap items-center gap-2 rounded p-2"
      >
        <input
          aria-label={`Word ${id}`}
          className="border-input bg-background w-32 rounded border px-1 py-0.5 text-sm font-medium"
          value={word.word}
          disabled={disabled}
          onChange={(e) => onEdit(editWordText(lines, l, w, e.target.value))}
        />
        <div className="flex items-center gap-1">
          <IconButton
            label={`Start earlier ${id}`}
            disabled={disabled}
            onClick={() => onEdit(nudgeWord(lines, l, w, "start", -NUDGE))}
          >
            ◂
          </IconButton>
          <TimeInput
            label={`Start ${id}`}
            value={word.start}
            onCommit={(v) => onEdit(setWordTime(lines, l, w, "start", v))}
          />
          <IconButton
            label={`Start later ${id}`}
            disabled={disabled}
            onClick={() => onEdit(nudgeWord(lines, l, w, "start", NUDGE))}
          >
            ▸
          </IconButton>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label={`End earlier ${id}`}
            disabled={disabled}
            onClick={() => onEdit(nudgeWord(lines, l, w, "end", -NUDGE))}
          >
            ◂
          </IconButton>
          <TimeInput
            label={`End ${id}`}
            value={word.end}
            onCommit={(v) => onEdit(setWordTime(lines, l, w, "end", v))}
          />
          <IconButton
            label={`End later ${id}`}
            disabled={disabled}
            onClick={() => onEdit(nudgeWord(lines, l, w, "end", NUDGE))}
          >
            ▸
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-1">
          <IconButton
            label={`Add word before ${id}`}
            disabled={disabled}
            onClick={() => onEdit(addWord(lines, l, w, "before"))}
          >
            +←
          </IconButton>
          <IconButton
            label={`Add word after ${id}`}
            disabled={disabled}
            onClick={() => onEdit(addWord(lines, l, w, "after"))}
          >
            +→
          </IconButton>
          <IconButton
            label={`Merge with next ${id}`}
            disabled={disabled || w === line.length - 1}
            onClick={() => onEdit(mergeWithNext(lines, l, w))}
          >
            Merge
          </IconButton>
          <IconButton
            label={`Delete word ${id}`}
            disabled={disabled}
            onClick={() => onEdit(deleteWord(lines, l, w))}
          >
            Del
          </IconButton>
          <IconButton
            label={`Break line before ${id}`}
            disabled={disabled || w === 0}
            onClick={() => onEdit(splitLine(lines, l, w))}
          >
            ⏎
          </IconButton>
          <IconButton
            label={`Move to previous line ${id}`}
            disabled={disabled || w !== 0 || l === 0}
            onClick={() => onEdit(moveWordToLine(lines, l, w, "prev"))}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move to next line ${id}`}
            disabled={disabled || w !== line.length - 1 || l === lines.length - 1}
            onClick={() => onEdit(moveWordToLine(lines, l, w, "next"))}
          >
            ↓
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {lines.length === 0 ? <p className="text-muted-foreground text-sm">No lines yet.</p> : null}
      {lines.map((line, l) => {
        const n = l + 1;
        const lineSelected = sel?.l === l;
        return (
          <div key={l} className="rounded border px-2 py-1">
            <div className="flex items-start gap-2">
              <div className="flex w-24 shrink-0 items-center gap-1 pt-0.5 text-xs">
                <span className="font-medium">Line {n}</span>
                <IconButton
                  label={`Add line after ${n}`}
                  disabled={disabled}
                  onClick={() => onEdit(addLine(lines, l))}
                >
                  +
                </IconButton>
                {line.length === 0 ? (
                  <IconButton
                    label={`Remove line ${n}`}
                    disabled={disabled}
                    onClick={() => onEdit(removeLine(lines, l))}
                  >
                    ×
                  </IconButton>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {line.map((word, w) => {
                  const isSel = sel?.l === l && sel.w === w;
                  return (
                    <span key={w} className="inline-flex flex-col items-center">
                      <button
                        type="button"
                        data-testid="word-chip"
                        aria-pressed={isSel}
                        aria-label={`Select word ${n}.${w + 1}: ${word.word}`}
                        disabled={disabled}
                        className={
                          isSel
                            ? "bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-sm"
                            : "bg-muted hover:bg-muted/70 rounded px-1.5 py-0.5 text-sm"
                        }
                        onClick={() => onSelect(l, w)}
                      >
                        {word.word || "·"}
                      </button>
                      {isSel ? (
                        <span className="text-muted-foreground text-[10px]">
                          {formatTime(word.start)}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
            {lineSelected ? renderEditor(sel!.l, sel!.w) : null}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useRef } from "react";

export type FlatWord = {
  l: number;
  w: number;
  word: string;
  start: number;
  end: number;
};

export type WordEdge = "start" | "end" | "move";

const EDGE_PX = 8;
const TOLERANCE_PX = 3;
const HEIGHT = 120;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function timeToX(t: number, width: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return (t / duration) * width;
}

export function xToTime(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return (x / width) * duration;
}

/** Find the word under pixel x and which part of it (edge or middle) was hit. */
export function hitTestWord(
  x: number,
  width: number,
  duration: number,
  words: FlatWord[],
): { word: FlatWord; edge: WordEdge } | { word: null; edge: null } {
  let best: { word: FlatWord; edge: WordEdge; dist: number } | null = null;
  for (const word of words) {
    const x0 = timeToX(word.start, width, duration);
    const x1 = timeToX(word.end, width, duration);
    if (x < x0 - TOLERANCE_PX || x > x1 + TOLERANCE_PX) continue;
    const dStart = Math.abs(x - x0);
    const dEnd = Math.abs(x - x1);
    let edge: WordEdge = "move";
    let dist: number;
    if (dStart <= EDGE_PX && dStart <= dEnd) {
      edge = "start";
      dist = dStart;
    } else if (dEnd <= EDGE_PX) {
      edge = "end";
      dist = dEnd;
    } else {
      dist = Math.min(dStart, dEnd) + EDGE_PX;
    }
    if (!best || dist < best.dist) best = { word, edge, dist };
  }
  return best ? { word: best.word, edge: best.edge } : { word: null, edge: null };
}

/**
 * Clamp a dragged time so starts stay non-decreasing: start within
 * [prevStart, min(end, nextStart)], end within [start, nextStart].
 */
export function clampWordTime(
  field: "start" | "end",
  t: number,
  word: { start: number; end: number },
  prev: { start: number } | null,
  next: { start: number } | null,
): number {
  let v = Math.max(0, t);
  if (field === "start") {
    v = Math.max(v, prev?.start ?? 0);
    v = Math.min(v, word.end);
    if (next) v = Math.min(v, next.start);
  } else {
    v = Math.max(v, word.start);
    if (next) v = Math.min(v, Math.max(next.start, word.start));
  }
  return round3(v);
}

/**
 * Clamp a whole-word move. The lower bound (previous word's start, or 0) always
 * wins over the upper bound (so the word still fits before the next start).
 */
export function clampWordMove(
  t: number,
  len: number,
  prev: { start: number } | null,
  next: { start: number } | null,
): { start: number; end: number } {
  const lo = prev?.start ?? 0;
  const hi = next ? next.start - len : Infinity;
  const start = round3(Math.max(lo, Math.min(hi, t)));
  return { start, end: round3(start + len) };
}

type Drag = {
  word: FlatWord;
  edge: WordEdge;
  startX: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
};

export function KaraokeWaveform({
  peaks,
  duration,
  currentTime,
  words,
  selected,
  onSeek,
  onSelect,
  onWordTimeChange,
}: {
  peaks: number[];
  duration: number;
  currentTime: number;
  words: FlatWord[];
  selected: { l: number; w: number } | null;
  onSeek: (t: number) => void;
  onSelect: (l: number, w: number) => void;
  onWordTimeChange: (l: number, w: number, field: "start" | "end", t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const drawRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    if (!(duration > 0) || width <= 0) return;

    // Peaks
    // A single placeholder peak means "no waveform data": draw no bars.
    if (peaks.length > 1) {
      ctx.fillStyle = "rgba(128,128,128,0.35)";
      const barW = width / peaks.length;
      const mid = (HEIGHT - 32) / 2;
      peaks.forEach((p, i) => {
        const h = Math.max(1, p * (HEIGHT - 40));
        ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 0.5), h);
      });
    }

    // Word blocks
    const top = HEIGHT - 28;
    for (const word of words) {
      const x0 = timeToX(word.start, width, duration);
      const x1 = timeToX(word.end, width, duration);
      const isSel = selected?.l === word.l && selected?.w === word.w;
      const rgb = word.l % 2 === 0 ? "59,130,246" : "236,72,153";
      ctx.fillStyle = isSel ? `rgb(${rgb})` : `rgba(${rgb},0.4)`;
      const bw = Math.max(2, x1 - x0 - 1);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x0, top, bw, 24, 4);
      else ctx.rect(x0, top, bw, 24);
      ctx.fill();
      if (bw > 24) {
        ctx.fillStyle = isSel ? "#fff" : "rgba(255,255,255,0.8)";
        ctx.font = "11px sans-serif";
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, bw, 24);
        ctx.clip();
        ctx.fillText(word.word, x0 + 3, top + 16);
        ctx.restore();
      }
    }

    // Playhead
    const px = timeToX(currentTime, width, duration);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(px - 1, 0, 2, HEIGHT);
  };

  useEffect(() => {
    drawRef.current();
  }, [peaks, duration, currentTime, words, selected]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => drawRef.current());
      ro.observe(wrap);
      return () => ro.disconnect();
    }
    const onResize = () => drawRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const pointerX = (e: React.PointerEvent) =>
    e.clientX - canvasRef.current!.getBoundingClientRect().left;
  const widthOf = () => wrapRef.current?.clientWidth ?? 0;

  const applyDrag = (d: Drag, x: number) => {
    const delta = xToTime(x - d.startX, widthOf(), duration);
    const i = words.findIndex((k) => k.l === d.word.l && k.w === d.word.w);
    const prev = words[i - 1] ?? null;
    const next = words[i + 1] ?? null;
    const orig = { start: d.origStart, end: d.origEnd };
    const emit = (f: "start" | "end", t: number) => onWordTimeChange(d.word.l, d.word.w, f, t);
    if (d.edge === "start") {
      emit("start", clampWordTime("start", d.origStart + delta, orig, prev, next));
    } else if (d.edge === "end") {
      emit("end", clampWordTime("end", d.origEnd + delta, orig, null, next));
    } else {
      const len = d.origEnd - d.origStart;
      const { start: newStart } = clampWordMove(d.origStart + delta, len, prev, next);
      // Write end first when moving right so end >= start holds at each step.
      if (newStart >= d.word.start) {
        emit("end", round3(newStart + len));
        emit("start", newStart);
      } else {
        emit("start", newStart);
        emit("end", round3(newStart + len));
      }
    }
  };

  return (
    <div ref={wrapRef} className="w-full" data-testid="karaoke-waveform">
      <canvas
        ref={canvasRef}
        data-peaks={peaks.length}
        aria-label="Waveform timeline"
        role="img"
        className="block touch-none rounded border"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          if (!(duration > 0)) return;
          const x = pointerX(e);
          const hit = hitTestWord(x, widthOf(), duration, words);
          if (!hit.word) {
            dragRef.current = null;
            onSeek(round3(xToTime(x, widthOf(), duration)));
            return;
          }
          dragRef.current = {
            word: hit.word,
            edge: hit.edge,
            startX: x,
            origStart: hit.word.start,
            origEnd: hit.word.end,
            moved: false,
          };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const x = pointerX(e);
          if (!d.moved && Math.abs(x - d.startX) < 2) return;
          d.moved = true;
          applyDrag(d, x);
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          if (d && !d.moved) {
            onSelect(d.word.l, d.word.w);
            onSeek(round3(xToTime(pointerX(e), widthOf(), duration)));
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
    </div>
  );
}

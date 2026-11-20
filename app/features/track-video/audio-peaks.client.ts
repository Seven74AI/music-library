/** Downsample samples into `targetBars` buckets of peak amplitude, normalized to 0..1. */
export function downsamplePeaks(samples: Float32Array, targetBars: number): number[] {
  const bars = Math.max(0, Math.floor(targetBars));
  if (bars === 0 || samples.length === 0) return [];
  const count = Math.min(bars, samples.length);
  const out = new Array<number>(count).fill(0);
  let max = 0;
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * samples.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / count));
    let peak = 0;
    for (let j = from; j < to; j++) {
      const a = Math.abs(samples[j]!);
      if (a > peak) peak = a;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  return max > 0 ? out.map((p) => p / max) : out;
}

/** Fetch raw audio bytes, decode with Web Audio, and return normalized peaks. */
export async function computePeaks(audioStreamUrl: string, targetBars = 1500): Promise<number[]> {
  const res = await fetch(audioStreamUrl);
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    return downsamplePeaks(decoded.getChannelData(0), targetBars);
  } finally {
    void ctx.close().catch(() => {});
  }
}

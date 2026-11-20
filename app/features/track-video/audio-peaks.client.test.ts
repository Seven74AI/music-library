import { expect, test } from "vitest";
import { downsamplePeaks } from "./audio-peaks.client.ts";

test("returns the requested number of bars in 0..1, normalized to the max", () => {
  const samples = new Float32Array(1000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 10) * 0.5;
  const peaks = downsamplePeaks(samples, 100);
  expect(peaks).toHaveLength(100);
  expect(Math.max(...peaks)).toBeCloseTo(1);
  for (const p of peaks) {
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  }
});

test("uses absolute value so negative peaks count", () => {
  const peaks = downsamplePeaks(new Float32Array([0.1, -0.8, 0.2, 0.4]), 2);
  expect(peaks[0]).toBeCloseTo(1);
  expect(peaks[1]).toBeCloseTo(0.5);
});

test("empty input or zero bars yields no bars", () => {
  expect(downsamplePeaks(new Float32Array(0), 10)).toEqual([]);
  expect(downsamplePeaks(new Float32Array([1, 2]), 0)).toEqual([]);
});

test("input shorter than the bar count yields one bar per sample", () => {
  expect(downsamplePeaks(new Float32Array([0.5, 1]), 10)).toEqual([0.5, 1]);
});

test("silence stays at zero (no NaN)", () => {
  expect(downsamplePeaks(new Float32Array(10), 5)).toEqual([0, 0, 0, 0, 0]);
});

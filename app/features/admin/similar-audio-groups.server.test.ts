import { describe, expect, test } from "vitest";
import { compressChromaprint } from "#tests/chromaprint-test-utils";
import {
  DUPLICATE_GROUP_PAGE_SIZE,
  SIMILAR_CANDIDATE_CAP,
  SIMILARITY_THRESHOLD,
  groupSimilarAudioFiles,
  type SimilarAudioCandidate,
} from "./similar-audio-groups.server.ts";

function candidate(
  overrides: Partial<SimilarAudioCandidate> & Pick<SimilarAudioCandidate, "audioFileId">,
): SimilarAudioCandidate {
  return {
    audioFileId: overrides.audioFileId,
    trackId: overrides.trackId ?? overrides.audioFileId,
    title: overrides.title ?? overrides.audioFileId,
    artist: overrides.artist ?? "Artist",
    fileSize: overrides.fileSize ?? 1000,
    contentHash:
      overrides.contentHash === undefined ? overrides.audioFileId : overrides.contentHash,
    fileName: overrides.fileName ?? null,
    format: overrides.format ?? "mp3",
    audioFingerprint: overrides.audioFingerprint ?? overrides.audioFileId,
    createdAt: overrides.createdAt ?? new Date("2024-01-01T00:00:00.000Z"),
  };
}

/** Fingerprints that stay well under the 0.9 threshold from each other. */
function divergentFingerprint(index: number): string {
  let state = index + 1;
  const chars: string[] = [];
  for (let pos = 0; pos < 48; pos++) {
    state = (Math.imul(state, 1103515245) + 12345 + pos) >>> 0;
    chars.push(String.fromCharCode(97 + (state % 26)));
  }
  return chars.join("");
}

describe("groupSimilarAudioFiles", () => {
  test("uses the same 0.9 threshold as track audio ingest", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.9);
  });

  test("groups fingerprints at the 0.9 threshold and rejects anything below it", () => {
    // 20 subfingerprints = 640 bits.
    const baseRaw = Array.from({ length: 20 }, (_, i) => 0x11110000 + i);
    const base = compressChromaprint(baseRaw);

    // One bit flipped in one subfingerprint => similarity 1 - 1/640 ≈ 0.9984.
    const nearRaw = [...baseRaw];
    nearRaw[5] = (nearRaw[5]! ^ 1) >>> 0;
    const near = compressChromaprint(nearRaw);

    // Every subfingerprint differs by 16 bits => similarity 1 - 320/640 = 0.5.
    const far = compressChromaprint(Array.from({ length: 20 }, (_, i) => 0xeeee0000 + i));

    const grouped = groupSimilarAudioFiles([
      candidate({
        audioFileId: "a",
        contentHash: "hash-a",
        audioFingerprint: base,
        createdAt: new Date("2024-01-01"),
      }),
      candidate({
        audioFileId: "b",
        contentHash: "hash-b",
        audioFingerprint: near,
        createdAt: new Date("2024-02-01"),
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(grouped[0]?.tracks.map((track) => track.audioFileId)).toEqual(["a", "b"]);
    expect(grouped[0]?.id).toBe("similar:a:b");
    expect(grouped[0]?.tracks[1]?.confidence).toBeCloseTo(1 - 1 / 640);

    const rejected = groupSimilarAudioFiles([
      candidate({
        audioFileId: "a",
        contentHash: "hash-a",
        audioFingerprint: base,
      }),
      candidate({
        audioFileId: "c",
        contentHash: "hash-c",
        audioFingerprint: far,
      }),
    ]);
    expect(rejected).toEqual([]);
  });

  test("does not group files that already share a content hash", () => {
    const groups = groupSimilarAudioFiles([
      candidate({
        audioFileId: "a",
        contentHash: "same-hash",
        audioFingerprint: "identical-fingerprint",
      }),
      candidate({
        audioFileId: "b",
        contentHash: "same-hash",
        audioFingerprint: "identical-fingerprint",
      }),
    ]);

    expect(groups).toEqual([]);
  });

  test("keeps one file per content hash inside a similar group", () => {
    const groups = groupSimilarAudioFiles([
      candidate({
        audioFileId: "original",
        contentHash: "hash-original",
        audioFingerprint: "0123456789",
        createdAt: new Date("2024-01-01"),
      }),
      candidate({
        audioFileId: "dup-early",
        contentHash: "hash-dup",
        audioFingerprint: "0123456789",
        createdAt: new Date("2024-02-01"),
      }),
      candidate({
        audioFileId: "dup-late",
        contentHash: "hash-dup",
        audioFingerprint: "0123456789",
        createdAt: new Date("2024-03-01"),
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tracks.map((track) => track.audioFileId)).toEqual(["original", "dup-early"]);
  });

  test("caps the candidate set so pairwise comparison stays bounded", () => {
    const candidates = Array.from({ length: SIMILAR_CANDIDATE_CAP + 1 }, (_, index) =>
      candidate({
        audioFileId: `file-${index}`,
        contentHash: `hash-${index}`,
        audioFingerprint: divergentFingerprint(index),
        createdAt: new Date(Date.UTC(2024, 0, 1, 0, index)),
      }),
    );
    const first = candidates[0]!;
    const beyondCap = candidates[SIMILAR_CANDIDATE_CAP]!;
    beyondCap.audioFingerprint = first.audioFingerprint;

    expect(groupSimilarAudioFiles(candidates)).toEqual([]);

    const included = groupSimilarAudioFiles(candidates, {
      candidateCap: SIMILAR_CANDIDATE_CAP + 1,
    });
    expect(included).toHaveLength(1);
    expect(included[0]?.tracks.map((track) => track.audioFileId).sort()).toEqual([
      first.audioFileId,
      beyondCap.audioFileId,
    ]);
  });

  test("returns at most 100 groups, matching the exact-hash page size", () => {
    expect(DUPLICATE_GROUP_PAGE_SIZE).toBe(100);
    const candidates: SimilarAudioCandidate[] = [];
    for (let index = 0; index < DUPLICATE_GROUP_PAGE_SIZE + 1; index++) {
      const fingerprint = divergentFingerprint(index);
      candidates.push(
        candidate({
          audioFileId: `left-${index}`,
          contentHash: `left-${index}`,
          audioFingerprint: fingerprint,
          createdAt: new Date(Date.UTC(2024, 0, 1, 0, index)),
        }),
        candidate({
          audioFileId: `right-${index}`,
          contentHash: `right-${index}`,
          audioFingerprint: fingerprint,
          createdAt: new Date(Date.UTC(2024, 0, 2, 0, index)),
        }),
      );
    }

    const groups = groupSimilarAudioFiles(candidates, {
      candidateCap: candidates.length,
    });
    expect(groups).toHaveLength(DUPLICATE_GROUP_PAGE_SIZE);
  });
});

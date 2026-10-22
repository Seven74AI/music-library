import { calculateFingerprintSimilarity } from "#app/utils/audio-file-management.server.ts";

/**
 * Same 90% cutoff used when a new upload is checked in
 * `app/features/track-audio-ingest/persist-track-audio.server.ts`.
 */
export const SIMILARITY_THRESHOLD = 0.9;

/**
 * Maximum audio files compared when building similar-audio groups.
 *
 * Similarity is pairwise, so the work grows with the square of this cap.
 * Callers should pass candidates newest-first (or another explicit order);
 * only the first `SIMILAR_CANDIDATE_CAP` entries are read. This keeps one
 * admin request from scanning an unbounded cartesian product.
 */
export const SIMILAR_CANDIDATE_CAP = 200;

/** Matches the exact content-hash query, which is also limited to 100 groups. */
export const DUPLICATE_GROUP_PAGE_SIZE = 100;

export interface SimilarAudioCandidate {
  audioFileId: string;
  trackId: string;
  title: string;
  artist: string;
  fileSize: number;
  contentHash: string | null;
  fileName: string | null;
  format: string | null;
  audioFingerprint: string;
  createdAt: Date;
}

export interface SimilarAudioTrack {
  trackId: string;
  title: string;
  artist: string;
  fileSize: number;
  contentHash: string;
  fileName: string | null;
  format: string | null;
  audioFileId: string;
  /** Similarity to the oldest file in the group, from 0 to 1. */
  confidence: number;
}

export interface SimilarAudioGroup {
  id: string;
  type: "similar";
  confidence: number;
  tracks: SimilarAudioTrack[];
}

function sameContentHash(a: SimilarAudioCandidate, b: SimilarAudioCandidate): boolean {
  return Boolean(a.contentHash && b.contentHash && a.contentHash === b.contentHash);
}

/**
 * Group files whose fingerprints are at least `SIMILARITY_THRESHOLD` similar
 * and that are not already the same content hash.
 *
 * The candidate list is sliced to `candidateCap` before any pairwise work.
 * Returned groups are capped at `maxGroups` (default 100), largest first.
 */
export function groupSimilarAudioFiles(
  candidates: SimilarAudioCandidate[],
  options?: {
    candidateCap?: number;
    maxGroups?: number;
    threshold?: number;
  },
): SimilarAudioGroup[] {
  const cap = options?.candidateCap ?? SIMILAR_CANDIDATE_CAP;
  const maxGroups = options?.maxGroups ?? DUPLICATE_GROUP_PAGE_SIZE;
  const threshold = options?.threshold ?? SIMILARITY_THRESHOLD;
  const limited = candidates.slice(0, cap).filter((candidate) => candidate.audioFingerprint);

  const parent = limited.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
  };

  const edges: Array<{ left: number; right: number; similarity: number }> = [];
  for (let left = 0; left < limited.length; left++) {
    for (let right = left + 1; right < limited.length; right++) {
      const a = limited[left]!;
      const b = limited[right]!;
      if (sameContentHash(a, b)) continue;
      const similarity = calculateFingerprintSimilarity(a.audioFingerprint, b.audioFingerprint);
      if (similarity >= threshold) {
        union(left, right);
        edges.push({ left, right, similarity });
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let index = 0; index < limited.length; index++) {
    const root = find(index);
    const members = components.get(root) ?? [];
    members.push(index);
    components.set(root, members);
  }

  const groups: SimilarAudioGroup[] = [];
  for (const indexes of components.values()) {
    const ordered = [...indexes].sort((left, right) => {
      const delta = limited[left]!.createdAt.getTime() - limited[right]!.createdAt.getTime();
      if (delta !== 0) return delta;
      return limited[left]!.audioFileId.localeCompare(limited[right]!.audioFileId);
    });

    const kept: number[] = [];
    const seenHashes = new Set<string>();
    for (const index of ordered) {
      const hash = limited[index]!.contentHash;
      if (hash) {
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);
      }
      kept.push(index);
    }
    if (kept.length < 2) continue;

    const keptSet = new Set(kept);
    let confidence = 1;
    let linked = false;
    for (const edge of edges) {
      if (!keptSet.has(edge.left) || !keptSet.has(edge.right)) continue;
      confidence = Math.min(confidence, edge.similarity);
      linked = true;
    }
    if (!linked) continue;

    const representative = limited[kept[0]!]!;
    const tracks = kept.map((index) => {
      const file = limited[index]!;
      const trackConfidence =
        file.audioFileId === representative.audioFileId
          ? 1
          : calculateFingerprintSimilarity(representative.audioFingerprint, file.audioFingerprint);
      return {
        trackId: file.trackId,
        title: file.title,
        artist: file.artist,
        fileSize: file.fileSize,
        contentHash: file.contentHash ?? "",
        fileName: file.fileName,
        format: file.format,
        audioFileId: file.audioFileId,
        confidence: trackConfidence,
      };
    });

    groups.push({
      id: `similar:${tracks
        .map((track) => track.audioFileId)
        .sort()
        .join(":")}`,
      type: "similar",
      confidence,
      tracks,
    });
  }

  groups.sort((left, right) => {
    if (right.tracks.length !== left.tracks.length) return right.tracks.length - left.tracks.length;
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return left.id.localeCompare(right.id);
  });

  return groups.slice(0, maxGroups);
}

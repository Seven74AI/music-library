import { prisma } from "#app/utils/db.server.ts";
import {
  DUPLICATE_GROUP_PAGE_SIZE,
  SIMILAR_CANDIDATE_CAP,
  groupSimilarAudioFiles,
  type SimilarAudioCandidate,
} from "./similar-audio-groups.server.ts";

export const DUPLICATE_FILTERS = ["all", "exact", "similar", "intentional"] as const;
export type DuplicateFilter = (typeof DUPLICATE_FILTERS)[number];

export interface DuplicateTrack {
  trackId: string;
  title: string;
  artist: string;
  fileSize: number;
  contentHash: string;
  fileName: string | null;
  format: string | null;
  audioFileId: string;
  /** Present on similar-audio groups. Similarity to the oldest file, from 0 to 1. */
  confidence?: number;
}

export interface DuplicateGroup {
  id: string;
  type: "exact" | "similar";
  contentHash: string | null;
  /** Present on similar-audio groups. Minimum linking similarity, from 0 to 1. */
  confidence?: number;
  tracks: DuplicateTrack[];
}

export interface DuplicateStats {
  storageSaved: number;
  duplicateGroups: number;
  totalDuplicates: number;
}

export interface DuplicateDashboard {
  stats: DuplicateStats;
  groups: DuplicateGroup[];
  filter: DuplicateFilter;
}

export function parseDuplicateFilter(value: string | null): DuplicateFilter {
  if (value && (DUPLICATE_FILTERS as readonly string[]).includes(value)) {
    return value as DuplicateFilter;
  }
  return "all";
}

export async function markDuplicateGroupIntentional(input: {
  groupKey: string;
  groupType: "exact" | "similar";
  createdBy: string;
}) {
  await prisma.duplicateIntentionalGroup.upsert({
    where: { groupKey: input.groupKey },
    create: {
      groupKey: input.groupKey,
      groupType: input.groupType,
      createdBy: input.createdBy,
    },
    update: {},
  });
}

function applyIntentionalFilter(
  groups: DuplicateGroup[],
  filter: DuplicateFilter,
  intentionalKeys: Set<string>,
) {
  if (filter === "intentional") {
    return groups.filter((group) => intentionalKeys.has(group.id));
  }
  return groups.filter((group) => !intentionalKeys.has(group.id));
}

function statsFor(groups: DuplicateGroup[]): DuplicateStats {
  let totalDuplicates = 0;
  let storageSaved = 0;

  for (const group of groups) {
    const duplicateCount = Math.max(group.tracks.length - 1, 0);
    totalDuplicates += duplicateCount;
    // Only exact content-hash groups share one stored object.
    if (group.type === "exact") {
      const fileSize = group.tracks[0]?.fileSize ?? 0;
      storageSaved += fileSize * duplicateCount;
    }
  }

  return {
    storageSaved,
    duplicateGroups: groups.length,
    totalDuplicates,
  };
}

async function loadExactGroups(limit: number): Promise<DuplicateGroup[]> {
  const duplicateHashes = await prisma.$queryRaw<Array<{ contentHash: string }>>`
    SELECT contentHash
    FROM TrackAudioFile
    WHERE contentHash IS NOT NULL
    GROUP BY contentHash
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `;

  const groups: DuplicateGroup[] = [];
  for (const { contentHash } of duplicateHashes) {
    const audioFiles = await prisma.trackAudioFile.findMany({
      where: { contentHash },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (audioFiles.length > 1) {
      groups.push({
        id: contentHash,
        type: "exact",
        contentHash,
        tracks: audioFiles.map((audioFile) => ({
          trackId: audioFile.track.id,
          title: audioFile.track.title,
          artist: audioFile.track.artist.name,
          fileSize: audioFile.fileSize ?? 0,
          contentHash: audioFile.contentHash ?? "",
          fileName: audioFile.fileName,
          format: audioFile.format,
          audioFileId: audioFile.id,
        })),
      });
    }
  }

  return groups;
}

async function loadSimilarGroups(): Promise<DuplicateGroup[]> {
  // Newest files only. `groupSimilarAudioFiles` also slices to this cap so a
  // larger result cannot expand the pairwise scan.
  const audioFiles = await prisma.trackAudioFile.findMany({
    where: { audioFingerprint: { not: null } },
    orderBy: { createdAt: "desc" },
    take: SIMILAR_CANDIDATE_CAP,
    include: {
      track: {
        select: {
          id: true,
          title: true,
          artist: {
            select: { name: true },
          },
        },
      },
    },
  });

  const candidates: SimilarAudioCandidate[] = [];
  for (const audioFile of audioFiles) {
    if (!audioFile.audioFingerprint) continue;
    candidates.push({
      audioFileId: audioFile.id,
      trackId: audioFile.track.id,
      title: audioFile.track.title,
      artist: audioFile.track.artist.name,
      fileSize: audioFile.fileSize ?? 0,
      contentHash: audioFile.contentHash,
      fileName: audioFile.fileName,
      format: audioFile.format,
      audioFingerprint: audioFile.audioFingerprint,
      createdAt: audioFile.createdAt,
    });
  }

  return groupSimilarAudioFiles(candidates).map((group) => ({
    id: group.id,
    type: "similar" as const,
    contentHash: null,
    confidence: group.confidence,
    tracks: group.tracks,
  }));
}

export async function loadDuplicateDashboard(filter: DuplicateFilter): Promise<DuplicateDashboard> {
  const intentionalRows = await prisma.duplicateIntentionalGroup.findMany({
    select: { groupKey: true },
  });
  const intentionalKeys = new Set(intentionalRows.map((row) => row.groupKey));
  // Over-fetch exact groups by the number of intentional keys so hiding one
  // still leaves a full page when more groups exist. The response is sliced
  // back to DUPLICATE_GROUP_PAGE_SIZE.
  const exactLimit = DUPLICATE_GROUP_PAGE_SIZE + intentionalKeys.size;

  const [exactGroups, similarGroups] = await Promise.all([
    filter === "similar" ? Promise.resolve([]) : loadExactGroups(exactLimit),
    filter === "exact" ? Promise.resolve([]) : loadSimilarGroups(),
  ]);

  const visibleExact = applyIntentionalFilter(exactGroups, filter, intentionalKeys);
  const visibleSimilar = applyIntentionalFilter(similarGroups, filter, intentionalKeys);

  const groups =
    filter === "exact"
      ? visibleExact.slice(0, DUPLICATE_GROUP_PAGE_SIZE)
      : filter === "similar"
        ? visibleSimilar.slice(0, DUPLICATE_GROUP_PAGE_SIZE)
        : [...visibleExact, ...visibleSimilar].slice(0, DUPLICATE_GROUP_PAGE_SIZE);

  return {
    stats: statsFor(groups),
    groups,
    filter,
  };
}

import { data } from "react-router";
import { type Prisma } from "#prisma/client.js";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/fingerprint-failures.ts";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const SIZE_FILTERS = ["all", "small", "medium", "large"] as const;
type SizeFilter = (typeof SIZE_FILTERS)[number];

/** Matches `formatBytes`, which labels 1024 bytes as 1 KB and 1024 KB as 1 MB. */
const BYTES_PER_MB = 1024 * 1024;

export interface FingerprintFailureStats {
  total: number;
  withContentHash: number;
  withAudioFingerprint: number;
  fingerprintFailed: number;
  unprocessed: number;
  healthyPercent: number;
}

export interface FingerprintFailureRow {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  objectKey: string;
  fileName: string | null;
  format: string | null;
  mimeType: string | null;
  fileSize: number | null;
  uploadedAt: string;
  serviceId: string | null;
  serviceName: string | null;
  contentHash: string | null;
  audioFingerprint: string | null;
}

export interface FingerprintFailuresLoaderData {
  stats: FingerprintFailureStats;
  failures: FingerprintFailureRow[];
  filters: {
    format: string;
    service: string;
    size: SizeFilter;
  };
  availableFormats: string[];
  availableServices: Array<{ name: string; displayName: string }>;
  page: number;
  pageSize: number;
  totalPages: number;
  totalFailures: number;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function sizeWhere(size: SizeFilter): Prisma.TrackAudioFileWhereInput {
  switch (size) {
    case "small":
      return { fileSize: { lt: BYTES_PER_MB } };
    case "medium":
      return { fileSize: { gte: BYTES_PER_MB, lt: 10 * BYTES_PER_MB } };
    case "large":
      return { fileSize: { gte: 10 * BYTES_PER_MB } };
    default:
      return {};
  }
}

function serviceWhere(service: string): Prisma.TrackAudioFileWhereInput {
  if (service === "all") return {};
  // Seeded and uploaded local files set serviceId to the local service.
  // Older rows may still have a null serviceId, which the schema treats as local.
  if (service === "local") {
    return {
      OR: [{ serviceId: null }, { service: { name: "local" } }],
    };
  }
  return { service: { name: service } };
}

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");

  const format = url.searchParams.get("format") ?? "all";
  const service = url.searchParams.get("service") ?? "all";
  const sizeParam = url.searchParams.get("size") ?? "all";
  const size: SizeFilter = SIZE_FILTERS.includes(sizeParam as SizeFilter)
    ? (sizeParam as SizeFilter)
    : "all";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
  );

  const failureBaseWhere: Prisma.TrackAudioFileWhereInput = {
    contentHash: { not: null },
    audioFingerprint: null,
  };

  const filteredFailureWhere: Prisma.TrackAudioFileWhereInput = {
    ...failureBaseWhere,
    ...(format !== "all" ? { format } : {}),
    ...serviceWhere(service),
    ...sizeWhere(size),
  };

  const [
    total,
    withContentHash,
    withAudioFingerprint,
    fingerprintFailed,
    unprocessed,
    healthy,
    totalFailures,
    failureRows,
    formatRows,
    serviceRows,
  ] = await Promise.all([
    prisma.trackAudioFile.count(),
    prisma.trackAudioFile.count({ where: { contentHash: { not: null } } }),
    prisma.trackAudioFile.count({ where: { audioFingerprint: { not: null } } }),
    prisma.trackAudioFile.count({ where: failureBaseWhere }),
    prisma.trackAudioFile.count({
      where: { contentHash: null, audioFingerprint: null },
    }),
    prisma.trackAudioFile.count({
      where: { contentHash: { not: null }, audioFingerprint: { not: null } },
    }),
    prisma.trackAudioFile.count({ where: filteredFailureWhere }),
    prisma.trackAudioFile.findMany({
      where: filteredFailureWhere,
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: { select: { name: true } },
          },
        },
        service: { select: { name: true, displayName: true } },
      },
    }),
    prisma.trackAudioFile.findMany({
      where: failureBaseWhere,
      distinct: ["format"],
      select: { format: true },
      orderBy: { format: "asc" },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      select: { name: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalFailures / pageSize));
  const healthyPercent = total === 0 ? 0 : Math.round((healthy / total) * 100);

  const stats: FingerprintFailureStats = {
    total,
    withContentHash,
    withAudioFingerprint,
    fingerprintFailed,
    unprocessed,
    healthyPercent,
  };

  const failures: FingerprintFailureRow[] = failureRows.map((row) => ({
    id: row.id,
    trackId: row.track.id,
    title: row.track.title,
    artist: row.track.artist.name,
    objectKey: row.objectKey,
    fileName: row.fileName,
    format: row.format,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadedAt: row.uploadedAt.toISOString(),
    serviceId: row.serviceId,
    serviceName: row.service?.name ?? (row.serviceId ? null : "local"),
    contentHash: row.contentHash,
    audioFingerprint: row.audioFingerprint,
  }));

  const availableFormats = formatRows
    .map((row) => row.format)
    .filter((value): value is string => Boolean(value));

  const payload: FingerprintFailuresLoaderData = {
    stats,
    failures,
    filters: { format, service, size },
    availableFormats,
    availableServices: [
      { name: "local", displayName: "Local upload" },
      ...serviceRows.filter((s) => s.name !== "local"),
    ],
    page,
    pageSize,
    totalPages,
    totalFailures,
  };

  return data(payload);
}

import { Prisma } from "#prisma/client.js";
import { data } from "react-router";
import { z } from "zod";
import { chunkArray } from "#app/utils/chunk-array";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  primaryGenreName,
  resolveOrderedGenres,
  snapshotGenreIds,
  type GenreRef,
} from "#app/utils/track-genres.server.ts";
import { type Route } from "./+types/bulk-edit.ts";

// Validation schema for changes object (all fields optional, but at least one required)
const ChangesSchema = z
  .object({
    title: z.string().min(1, "Title cannot be empty").optional(),
    artistId: z.string().min(1, "Artist ID cannot be empty").optional(),
    albumId: z.string().nullable().optional(),
    genre: z.string().nullable().optional(),
    genreIds: z.array(z.string()).optional(),
    year: z.number().int().nullable().optional(),
    trackNumber: z.number().int().nullable().optional(),
    albumArtist: z.string().nullable().optional(),
    bpm: z.number().int().nullable().optional(),
    label: z.string().nullable().optional(),
    isrc: z.string().nullable().optional(),
    releaseDate: z.string().nullable().optional(), // ISO date string
    originalDate: z.string().nullable().optional(),
    originalYear: z.number().int().nullable().optional(),
    totalTracks: z.number().int().nullable().optional(),
    totalDiscs: z.number().int().nullable().optional(),
    lyrics: z.string().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided in changes",
  });

// ADR-031: soft limit of 100 tracks per bulk edit, with an explicit override to
// raise it to the hard cap. Live progress, partial-failure handling and
// cancellation-with-rollback are not yet implemented (tracked separately).
const BULK_EDIT_SOFT_LIMIT = 100;
const BULK_EDIT_HARD_LIMIT = 500;

// Validation schema for bulk edit request
const BulkEditSchema = z
  .object({
    trackIds: z
      .array(z.string())
      .min(1, "At least one track ID is required")
      .max(BULK_EDIT_HARD_LIMIT, `Maximum ${BULK_EDIT_HARD_LIMIT} tracks per request`),
    changes: ChangesSchema,
    comment: z.string().min(1, "Comment is required for bulk operations"),
    overrideLimit: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.trackIds.length > BULK_EDIT_SOFT_LIMIT && !value.overrideLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackIds"],
        message: `Bulk edit is limited to ${BULK_EDIT_SOFT_LIMIT} tracks by default. Pass \`overrideLimit: true\` to process up to ${BULK_EDIT_HARD_LIMIT}.`,
      });
    }
  });

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const userId = await requireCuratorRole(request);

  // Get and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body
  const parseResult = BulkEditSchema.safeParse(body);
  if (!parseResult.success) {
    return data(
      {
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { trackIds, changes, comment } = parseResult.data;

  // Validate all tracks exist first (all-or-nothing approach)
  const tracks = await prisma.track.findMany({
    where: { id: { in: trackIds } },
    select: {
      id: true,
      title: true,
      artistId: true,
      albumId: true,
      genre: true,
      genres: {
        select: {
          id: true,
          name: true,
        },
      },
      year: true,
      trackNumber: true,
      albumArtist: true,
      bpm: true,
      label: true,
      isrc: true,
      releaseDate: true,
      originalDate: true,
      originalYear: true,
      totalTracks: true,
      totalDiscs: true,
      lyrics: true,
    },
  });

  // Check if all tracks exist
  if (tracks.length !== trackIds.length) {
    const foundIds = new Set(tracks.map((t) => t.id));
    const missingIds = trackIds.filter((id) => !foundIds.has(id));
    return data(
      {
        error: "Some tracks not found",
        missingTrackIds: missingIds,
      },
      { status: 404 },
    );
  }

  // Verify artist exists if artistId is being changed
  if (changes.artistId) {
    const artist = await prisma.artist.findUnique({
      where: { id: changes.artistId },
      select: { id: true },
    });

    if (!artist) {
      return data({ error: "Artist not found" }, { status: 404 });
    }
  }

  // Verify album exists if albumId is being changed and is not null
  if (changes.albumId !== undefined && changes.albumId !== null) {
    const album = await prisma.album.findUnique({
      where: { id: changes.albumId },
      select: { id: true },
    });

    if (!album) {
      return data({ error: "Album not found" }, { status: 404 });
    }
  }

  let resolvedGenres: GenreRef[] | undefined;
  if (changes.genreIds !== undefined) {
    const resolved = await resolveOrderedGenres(changes.genreIds);
    if (!resolved.ok) {
      return data({ error: "One or more genres not found" }, { status: 404 });
    }
    resolvedGenres = resolved.genres;
  }

  // Parse dates if provided
  const releaseDate =
    changes.releaseDate !== undefined
      ? changes.releaseDate
        ? new Date(changes.releaseDate)
        : null
      : undefined;
  const originalDate =
    changes.originalDate !== undefined
      ? changes.originalDate
        ? new Date(changes.originalDate)
        : null
      : undefined;

  // Perform bulk update in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Batch-create edit history entries (one createMany instead of N creates).
    await tx.trackEdit.createMany({
      data: tracks.map((track) => ({
        trackId: track.id,
        editedBy: userId,
        comment: comment,
        // Snapshot current state
        title: track.title,
        artistId: track.artistId,
        albumId: track.albumId,
        genre: track.genre,
        genreIds: snapshotGenreIds(track.genres, track.genre),
        year: track.year,
        trackNumber: track.trackNumber,
        albumArtist: track.albumArtist,
        bpm: track.bpm,
        label: track.label,
        isrc: track.isrc,
        releaseDate: track.releaseDate,
        originalDate: track.originalDate,
        originalYear: track.originalYear,
        totalTracks: track.totalTracks,
        totalDiscs: track.totalDiscs,
        lyrics: track.lyrics,
      })),
    });

    // 2. Build a single uniform update object — every track receives the same
    //    scalar changes, so one updateMany replaces N per-track updates.
    const trackUpdateData: any = {};

    if (changes.title !== undefined) trackUpdateData.title = changes.title;
    if (changes.artistId !== undefined) trackUpdateData.artistId = changes.artistId;
    if (changes.albumId !== undefined) trackUpdateData.albumId = changes.albumId;
    if (changes.year !== undefined) trackUpdateData.year = changes.year;
    if (changes.trackNumber !== undefined) trackUpdateData.trackNumber = changes.trackNumber;
    if (changes.albumArtist !== undefined) trackUpdateData.albumArtist = changes.albumArtist;
    if (changes.bpm !== undefined) trackUpdateData.bpm = changes.bpm;
    if (changes.label !== undefined) trackUpdateData.label = changes.label;
    if (changes.isrc !== undefined) trackUpdateData.isrc = changes.isrc;
    if (releaseDate !== undefined) trackUpdateData.releaseDate = releaseDate;
    if (originalDate !== undefined) trackUpdateData.originalDate = originalDate;
    if (changes.originalYear !== undefined) trackUpdateData.originalYear = changes.originalYear;
    if (changes.totalTracks !== undefined) trackUpdateData.totalTracks = changes.totalTracks;
    if (changes.totalDiscs !== undefined) trackUpdateData.totalDiscs = changes.totalDiscs;
    if (changes.lyrics !== undefined) trackUpdateData.lyrics = changes.lyrics;

    // The legacy `genre` string is uniform too; the many-to-many link
    // replacement is handled with set-based SQL below.
    let genreIdsToSet: string[] | undefined;
    if (resolvedGenres !== undefined) {
      trackUpdateData.genre = primaryGenreName(resolvedGenres);
      genreIdsToSet = resolvedGenres.map((genre) => genre.id);
    } else if (changes.genre !== undefined) {
      trackUpdateData.genre = changes.genre;
    }

    // 3. Apply the uniform scalar changes in a single query.
    await tx.track.updateMany({
      where: { id: { in: trackIds } },
      data: trackUpdateData,
    });

    // 4. Replace genre links for all tracks with set-based SQL (2 queries total).
    if (genreIdsToSet !== undefined) {
      await replaceTrackGenreLinks(tx, trackIds, genreIdsToSet);
    }

    return trackIds.length;
  });

  return data({
    success: true,
    updatedCount: result,
    updated: result,
  });
}

/**
 * Replace the genre many-to-many links for a set of tracks.
 *
 * Instead of a nested `genres: { set }` per track (N queries), this deletes
 * every existing link for the affected tracks in one pass and inserts the new
 * links in one multi-row INSERT per genre × chunk.
 */
async function replaceTrackGenreLinks(
  tx: any,
  trackIds: string[],
  genreIds: string[],
): Promise<void> {
  // Remove every existing genre link for the affected tracks.
  for (const chunk of chunkArray(trackIds)) {
    await tx.$executeRaw`
      DELETE FROM _TrackGenres WHERE B IN (${Prisma.join(chunk.map((id) => Prisma.sql`${id}`))})
    `;
  }

  // Insert the new links, one multi-row INSERT per genre × chunk.
  for (const genreId of genreIds) {
    for (const chunk of chunkArray(trackIds, 400)) {
      await tx.$executeRaw`
        INSERT INTO _TrackGenres (A, B) VALUES ${Prisma.join(
          chunk.map((trackId) => Prisma.sql`(${genreId}, ${trackId})`),
        )}
      `;
    }
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import {
  assertEditLockInTransaction,
  EditLockTransactionError,
  getLockStatus,
  releaseLock,
} from "#app/utils/locks.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  primaryGenreName,
  resolveOrderedGenres,
  resolveOrderedGenresFromNames,
  snapshotGenreIds,
  type GenreRef,
} from "#app/utils/track-genres.server.ts";
import { type Route } from "./+types/$trackId.edit.ts";

const dateString = (label: string) =>
  z.string().refine((v) => !Number.isNaN(Date.parse(v)), `${label} must be a valid date`);

const optionalNullableDate = (label: string) => z.union([dateString(label), z.null()]).optional();

// Validation schema for track edit
const EditTrackSchema = z.object({
  title: z.string().min(1, "Title is required"),
  artistId: z.string().min(1, "Artist ID is required"),
  albumId: z.string().nullable().optional(),
  genre: z.string().nullable().optional(), // Keep for backward compatibility
  genreIds: z.array(z.string()).optional(), // New multi-genre support
  year: z.number().int().nullable().optional(),
  trackNumber: z.number().int().nullable().optional(),
  albumArtist: z.string().nullable().optional(),
  bpm: z.number().int().nullable().optional(),
  label: z.string().nullable().optional(),
  isrc: z.string().nullable().optional(),
  releaseDate: optionalNullableDate("releaseDate"),
  originalDate: optionalNullableDate("originalDate"),
  originalYear: z.number().int().nullable().optional(),
  totalTracks: z.number().int().nullable().optional(),
  totalDiscs: z.number().int().nullable().optional(),
  lyrics: z.string().nullable().optional(),
  comment: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const userId = await requireCuratorRole(request);
  const { trackId } = params;

  if (!trackId) {
    throw data({ error: "Track ID is required" }, { status: 400 });
  }

  // Get and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate request body
  const parseResult = EditTrackSchema.safeParse(body);
  if (!parseResult.success) {
    throw data(
      {
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const editData = parseResult.data;

  // Verify track exists
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      artistId: true,
      albumId: true,
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

  if (!track) {
    throw data({ error: "Track not found" }, { status: 404 });
  }

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: editData.artistId },
    select: { id: true },
  });

  if (!artist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Verify album exists if provided
  if (editData.albumId) {
    const album = await prisma.album.findUnique({
      where: { id: editData.albumId },
      select: { id: true },
    });

    if (!album) {
      throw data({ error: "Album not found" }, { status: 404 });
    }
  }

  const lock = await getLockStatus("track", trackId);
  if (lock && lock.lockedBy !== userId) {
    throw data(
      {
        error: "Locked",
        message: `${lock.lockedByName} is currently editing this track`,
      },
      { status: 409 },
    );
  }

  let nextGenres: GenreRef[] | undefined;
  if (editData.genreIds !== undefined) {
    const resolved = await resolveOrderedGenres(editData.genreIds);
    if (!resolved.ok) {
      throw data({ error: "One or more genres not found" }, { status: 404 });
    }
    nextGenres = resolved.genres;
  } else if (editData.genre !== undefined) {
    if (editData.genre === null || editData.genre.trim() === "") {
      nextGenres = [];
    } else {
      const resolved = await resolveOrderedGenresFromNames([editData.genre]);
      if (!resolved.ok) {
        throw data({ error: "Failed to resolve genre" }, { status: 400 });
      }
      nextGenres = resolved.genres;
    }
  }

  // Parse dates
  const releaseDate = editData.releaseDate ? new Date(editData.releaseDate) : null;
  const originalDate = editData.originalDate ? new Date(editData.originalDate) : null;

  // Perform update and create history entry in a transaction
  let result: {
    track: Awaited<ReturnType<typeof prisma.track.update>>;
    edit: Awaited<ReturnType<typeof prisma.trackEdit.create>>;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      await assertEditLockInTransaction(tx, "track", trackId, userId, lock);

      const trackBeforeWrite = await tx.track.findUnique({
        where: { id: trackId },
        select: {
          id: true,
          title: true,
          artistId: true,
          albumId: true,
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

      if (!trackBeforeWrite) {
        throw data({ error: "Track not found" }, { status: 404 });
      }

      // Create history entry with current state (before update)
      const editEntry = await tx.trackEdit.create({
        data: {
          trackId: trackBeforeWrite.id,
          editedBy: userId,
          comment: editData.comment || null,
          // Snapshot current state
          title: trackBeforeWrite.title,
          artistId: trackBeforeWrite.artistId,
          albumId: trackBeforeWrite.albumId,
          genre: primaryGenreName(trackBeforeWrite.genres ?? []),
          genreIds: snapshotGenreIds(trackBeforeWrite.genres),
          year: trackBeforeWrite.year,
          trackNumber: trackBeforeWrite.trackNumber,
          albumArtist: trackBeforeWrite.albumArtist,
          bpm: trackBeforeWrite.bpm,
          label: trackBeforeWrite.label,
          isrc: trackBeforeWrite.isrc,
          releaseDate: trackBeforeWrite.releaseDate,
          originalDate: trackBeforeWrite.originalDate,
          originalYear: trackBeforeWrite.originalYear,
          totalTracks: trackBeforeWrite.totalTracks,
          totalDiscs: trackBeforeWrite.totalDiscs,
          lyrics: trackBeforeWrite.lyrics,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      });

      // Update track with new data
      const updatedTrack = await tx.track.update({
        where: { id: trackId },
        data: {
          title: editData.title,
          artistId: editData.artistId,
          albumId: editData.albumId === undefined ? trackBeforeWrite.albumId : editData.albumId,
          year: editData.year === undefined ? trackBeforeWrite.year : editData.year,
          trackNumber:
            editData.trackNumber === undefined
              ? trackBeforeWrite.trackNumber
              : editData.trackNumber,
          albumArtist:
            editData.albumArtist === undefined
              ? trackBeforeWrite.albumArtist
              : editData.albumArtist,
          bpm: editData.bpm === undefined ? trackBeforeWrite.bpm : editData.bpm,
          label: editData.label === undefined ? trackBeforeWrite.label : editData.label,
          isrc: editData.isrc === undefined ? trackBeforeWrite.isrc : editData.isrc,
          releaseDate:
            editData.releaseDate === undefined ? trackBeforeWrite.releaseDate : releaseDate,
          originalDate:
            editData.originalDate === undefined ? trackBeforeWrite.originalDate : originalDate,
          originalYear:
            editData.originalYear === undefined
              ? trackBeforeWrite.originalYear
              : editData.originalYear,
          totalTracks:
            editData.totalTracks === undefined
              ? trackBeforeWrite.totalTracks
              : editData.totalTracks,
          totalDiscs:
            editData.totalDiscs === undefined ? trackBeforeWrite.totalDiscs : editData.totalDiscs,
          lyrics: editData.lyrics === undefined ? trackBeforeWrite.lyrics : editData.lyrics,
          ...(nextGenres !== undefined && {
            genres: {
              set: nextGenres.map((genre) => ({ id: genre.id })),
            },
          }),
        },
        include: {
          artist: {
            select: {
              id: true,
              name: true,
            },
          },
          albumRecord: {
            select: {
              id: true,
              name: true,
            },
          },
          genres: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        track: updatedTrack,
        edit: editEntry,
      };
    });
  } catch (error) {
    if (error instanceof EditLockTransactionError) {
      if (error.violation.kind === "other") {
        throw data(
          {
            error: "Locked",
            message: `${error.violation.lockedByName} is currently editing this track`,
          },
          { status: 409 },
        );
      }
      throw data(
        {
          error: "Locked",
          message: "Your edit lock on this track is no longer active",
        },
        { status: 409 },
      );
    }
    throw error;
  }

  // Release the lock on successful save (ADR-032).
  if (lock) {
    await releaseLock("track", trackId, userId, {
      lockId: lock.id,
      acquiredAt: lock.acquiredAt,
    });
  }

  return data(result);
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

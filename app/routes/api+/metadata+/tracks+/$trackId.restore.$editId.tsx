import { data } from "react-router";
import { z } from "zod";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  parseGenreIdSnapshot,
  primaryGenreName,
  resolveOrderedGenres,
  snapshotGenreIds,
  type GenreRef,
} from "#app/utils/track-genres.server.ts";
import { type Route } from "./+types/$trackId.restore.$editId.ts";

const RestoreSchema = z.object({
  comment: z.string().min(1, "Comment is required to explain why restoring"),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const userId = await requireCuratorRole(request);
  const { trackId, editId } = params;

  if (!trackId) {
    throw data({ error: "Track ID is required" }, { status: 400 });
  }

  if (!editId) {
    throw data({ error: "Edit ID is required" }, { status: 400 });
  }

  // Get and validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = RestoreSchema.safeParse(body);
  if (!parseResult.success) {
    throw data(
      {
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { comment } = parseResult.data;

  // Verify track exists
  const track = await prisma.track.findUnique({
    where: { id: trackId },
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

  if (!track) {
    throw data({ error: "Track not found" }, { status: 404 });
  }

  // Verify edit exists and belongs to this track
  const editToRestore = await prisma.trackEdit.findUnique({
    where: { id: editId },
    select: {
      id: true,
      trackId: true,
      title: true,
      artistId: true,
      albumId: true,
      genre: true,
      genreIds: true,
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

  if (!editToRestore) {
    throw data({ error: "Edit not found" }, { status: 404 });
  }

  if (editToRestore.trackId !== trackId) {
    throw data({ error: "Edit does not belong to this track" }, { status: 400 });
  }

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: editToRestore.artistId },
    select: { id: true },
  });

  if (!artist) {
    throw data({ error: "Artist from restored version no longer exists" }, { status: 404 });
  }

  // Verify album exists if provided
  if (editToRestore.albumId) {
    const album = await prisma.album.findUnique({
      where: { id: editToRestore.albumId },
      select: { id: true },
    });

    if (!album) {
      throw data({ error: "Album from restored version no longer exists" }, { status: 404 });
    }
  }

  const parsedGenreIds = parseGenreIdSnapshot(editToRestore.genreIds);
  if (parsedGenreIds.status === "invalid") {
    throw data({ error: "Invalid genre snapshot" }, { status: 400 });
  }

  let restoredGenres: GenreRef[] | undefined;
  if (parsedGenreIds.status === "present") {
    const resolved = await resolveOrderedGenres(parsedGenreIds.ids);
    if (!resolved.ok) {
      throw data(
        { error: "One or more genres from the restored version no longer exist" },
        { status: 404 },
      );
    }
    restoredGenres = resolved.genres;
  }

  // Perform restore: create history entry with current state, then update track
  const result = await prisma.$transaction(async (tx) => {
    // Create history entry with current state (before restore)
    const editEntry = await tx.trackEdit.create({
      data: {
        trackId: track.id,
        editedBy: userId,
        comment: `Restore to version ${editId}: ${comment}`,
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

    // Update track with restored data
    const updatedTrack = await tx.track.update({
      where: { id: trackId },
      data: {
        title: editToRestore.title,
        artistId: editToRestore.artistId,
        albumId: editToRestore.albumId,
        genre:
          restoredGenres !== undefined ? primaryGenreName(restoredGenres) : editToRestore.genre,
        ...(restoredGenres !== undefined && {
          genres: {
            set: restoredGenres.map((genre) => ({ id: genre.id })),
          },
        }),
        year: editToRestore.year,
        trackNumber: editToRestore.trackNumber,
        albumArtist: editToRestore.albumArtist,
        bpm: editToRestore.bpm,
        label: editToRestore.label,
        isrc: editToRestore.isrc,
        releaseDate: editToRestore.releaseDate,
        originalDate: editToRestore.originalDate,
        originalYear: editToRestore.originalYear,
        totalTracks: editToRestore.totalTracks,
        totalDiscs: editToRestore.totalDiscs,
        lyrics: editToRestore.lyrics,
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
      },
    });

    return {
      track: updatedTrack,
      edit: editEntry,
    };
  });

  return data(result);
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

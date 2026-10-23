import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { labelsForChangeSets } from "#app/utils/history-display.server.ts";
import { type Route } from "./+types/$trackId.history.ts";

interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

interface Changes {
  [field: string]: FieldChange;
}

/** The editable track fields snapshot as stored on TrackEdit and queried from Track. */
type TrackStateSnapshot = {
  title: string;
  artistId: string;
  albumId: string | null;
  genre: string | null;
  year: number | null;
  trackNumber: number | null;
  albumArtist: string | null;
  bpm: number | null;
  label: string | null;
  isrc: string | null;
  releaseDate: Date | null;
  originalDate: Date | null;
  originalYear: number | null;
  totalTracks: number | null;
  totalDiscs: number | null;
  lyrics: string | null;
};

function computeChanges(previous: TrackStateSnapshot, current: TrackStateSnapshot): Changes {
  const changes: Changes = {};
  const fields = [
    "title",
    "artistId",
    "albumId",
    "genre",
    "year",
    "trackNumber",
    "albumArtist",
    "bpm",
    "label",
    "isrc",
    "releaseDate",
    "originalDate",
    "originalYear",
    "totalTracks",
    "totalDiscs",
    "lyrics",
  ] as const;

  for (const field of fields) {
    const prevValue = previous[field];
    const currValue = current[field];

    // Normalize DateTime fields to ISO strings for stable comparison.
    const prevStr = prevValue instanceof Date ? prevValue.toISOString() : prevValue;
    const currStr = currValue instanceof Date ? currValue.toISOString() : currValue;

    // Compare values
    if (prevStr !== currStr) {
      changes[field] = {
        from: prevStr,
        to: currStr,
      };
    }
  }

  return changes;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCuratorRole(request);
  const { trackId } = params;

  if (!trackId) {
    throw data({ error: "Track ID is required" }, { status: 400 });
  }

  // Verify track exists
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true },
  });

  if (!track) {
    throw data({ error: "Track not found" }, { status: 404 });
  }

  // Get all edits for this track, ordered by most recent first
  const edits = await prisma.trackEdit.findMany({
    where: { trackId },
    orderBy: { editedAt: "desc" },
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

  // Current track state (existence verified above; null only if deleted mid-request).
  const currentTrack = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      title: true,
      artistId: true,
      albumId: true,
      genre: true,
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

  if (!currentTrack) {
    throw data({ error: "Track not found" }, { status: 404 });
  }

  // Compute changes for each edit, walking from most recent to oldest: the
  // newest edit is compared against the current track, then each older edit is
  // compared against its successor (the next-newer edit).
  let nextState: TrackStateSnapshot = currentTrack;
  const history = edits.map((edit) => {
    const changes = computeChanges(edit, nextState);
    nextState = edit;

    return {
      id: edit.id,
      editedAt: edit.editedAt.toISOString(),
      editedBy: {
        id: edit.user.id,
        username: edit.user.username,
        name: edit.user.name || edit.user.username,
      },
      comment: edit.comment,
      changes,
    };
  });

  const labels = await labelsForChangeSets(history.map((entry) => entry.changes));
  for (const [index, entry] of history.entries()) {
    Object.assign(entry, { labels: labels[index] });
  }

  return data({ history });
}

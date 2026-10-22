import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { labelsForChangeSets } from "#app/utils/history-display.server.ts";
import { type Route } from "./+types/$trackId.history.ts";

interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

interface Changes {
  [field: string]: FieldChange;
}

function computeChanges(previous: any, current: any): Changes {
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
  ];

  for (const field of fields) {
    const prevValue = previous[field];
    const currValue = current[field];

    // Handle dates
    let prevStr = prevValue;
    let currStr = currValue;

    if (prevValue instanceof Date) {
      prevStr = prevValue.toISOString();
    }
    if (currValue instanceof Date) {
      currStr = currValue.toISOString();
    }

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
  await requireUserId(request);
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

  // Get current track state
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

  // Compute changes for each edit
  // The first edit (most recent) is compared with current track state
  // Subsequent edits are compared with the previous edit
  const history = edits.map((edit, index) => {
    const nextState = index === 0 ? currentTrack : edits[index - 1];
    const changes = computeChanges(edit, nextState);

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

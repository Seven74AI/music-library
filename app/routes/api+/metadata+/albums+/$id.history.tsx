import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { labelsForChangeSets } from "#app/utils/history-display.server.ts";
import { type Route } from "./+types/$id.history.ts";

interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

interface Changes {
  [field: string]: FieldChange;
}

/** The editable album fields snapshot as stored on AlbumEdit and queried from Album. */
type AlbumStateSnapshot = {
  name: string;
  artistId: string;
  year: number | null;
  coverImageId: string | null;
};

function computeChanges(previous: AlbumStateSnapshot, current: AlbumStateSnapshot): Changes {
  const changes: Changes = {};
  const fields = ["name", "artistId", "year", "coverImageId"] as const;

  for (const field of fields) {
    const prevValue = previous[field];
    const currValue = current[field];

    // Compare values
    if (prevValue !== currValue) {
      changes[field] = {
        from: prevValue,
        to: currValue,
      };
    }
  }

  return changes;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCuratorRole(request);
  const { id: albumId } = params;

  if (!albumId) {
    throw data({ error: "Album ID is required" }, { status: 400 });
  }

  // Get all edits for this album, ordered by most recent first
  const edits = await prisma.albumEdit.findMany({
    where: { albumId },
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

  // Current album state also serves as the existence check (→ 404 if missing).
  const currentAlbum = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      name: true,
      artistId: true,
      year: true,
      coverImageId: true,
    },
  });

  if (!currentAlbum) {
    throw data({ error: "Album not found" }, { status: 404 });
  }

  // Compute changes for each edit, walking from most recent to oldest: the
  // newest edit is compared against the current album, then each older edit is
  // compared against its successor (the next-newer edit).
  let nextState: AlbumStateSnapshot = currentAlbum;
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

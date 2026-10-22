import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { labelsForChangeSets } from "#app/utils/history-display.server.ts";
import { type Route } from "./+types/$id.history.ts";

interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

interface Changes {
  [field: string]: FieldChange;
}

function computeChanges(previous: any, current: any): Changes {
  const changes: Changes = {};
  const fields = ["name", "artistId", "year", "coverImageId"];

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
  await requireUserId(request);
  const { id: albumId } = params;

  if (!albumId) {
    throw data({ error: "Album ID is required" }, { status: 400 });
  }

  // Verify album exists
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: { id: true },
  });

  if (!album) {
    throw data({ error: "Album not found" }, { status: 404 });
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

  // Get current album state
  const currentAlbum = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      name: true,
      artistId: true,
      year: true,
      coverImageId: true,
    },
  });

  // Compute changes for each edit
  // The first edit (most recent) is compared with current album state
  // Subsequent edits are compared with the previous edit
  const history = edits.map((edit, index) => {
    const nextState = index === 0 ? currentAlbum : edits[index - 1];
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

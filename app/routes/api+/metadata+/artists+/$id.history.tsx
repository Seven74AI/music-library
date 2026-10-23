import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/$id.history.ts";

interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

interface Changes {
  [field: string]: FieldChange;
}

/** The editable artist fields snapshot as stored on ArtistEdit and queried from Artist. */
type ArtistStateSnapshot = {
  name: string;
  bio: string | null;
  imageUrl: string | null;
  website: string | null;
  genre: string | null;
  country: string | null;
};

function computeChanges(previous: ArtistStateSnapshot, current: ArtistStateSnapshot): Changes {
  const changes: Changes = {};
  const fields = ["name", "bio", "genre", "country", "imageUrl", "website"] as const;

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
  const { id: artistId } = params;

  if (!artistId) {
    throw data({ error: "Artist ID is required" }, { status: 400 });
  }

  // Verify artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: { id: true },
  });

  if (!artist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Get all edits for this artist, ordered by most recent first
  const edits = await prisma.artistEdit.findMany({
    where: { artistId },
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

  // Current artist state (existence verified above; null only if deleted mid-request).
  const currentArtist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: {
      name: true,
      bio: true,
      genre: true,
      country: true,
      imageUrl: true,
      website: true,
    },
  });

  if (!currentArtist) {
    throw data({ error: "Artist not found" }, { status: 404 });
  }

  // Compute changes for each edit, walking from most recent to oldest: the
  // newest edit is compared against the current artist, then each older edit is
  // compared against its successor (the next-newer edit).
  let nextState: ArtistStateSnapshot = currentArtist;
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

  return data({ history });
}

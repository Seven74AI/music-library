import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
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
  const fields = ["name", "bio", "genre", "country", "imageUrl", "website"];

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

  // Get current artist state
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

  // Compute changes for each edit
  // The first edit (most recent) is compared with current artist state
  // Subsequent edits are compared with the previous edit
  const history = edits.map((edit, index) => {
    const nextState = index === 0 ? currentArtist : edits[index - 1];
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

  return data({ history });
}

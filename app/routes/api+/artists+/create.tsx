import { data } from "react-router";
import { z } from "zod";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { normalizeArtistName } from "#app/utils/normalize.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/create.ts";

const CreateArtistSchema = z.object({
  name: z.string().min(1, "Artist name is required").max(255),
});

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);

  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const result = CreateArtistSchema.safeParse(body);

  if (!result.success) {
    throw data(
      {
        error: "Validation failed",
        details: result.error.issues,
      },
      { status: 400 },
    );
  }

  const normalizedName = normalizeArtistName(result.data.name);

  // Soft duplicate guard. Duplicate artists are a supported state (ADR-034
  // duplicate-detection + merge workflow), so `Artist.normalizedName` is
  // deliberately NOT unique (see migration
  // `20260927010000_remove_unique_constraints_for_duplicates`). This check is
  // best-effort UX to avoid obvious re-creation; a concurrent create may still
  // produce a duplicate, which the merge tool reconciles.
  const existingArtist = await prisma.artist.findFirst({
    where: { normalizedName },
  });

  if (existingArtist) {
    throw data(
      {
        error: "Artist already exists",
        artist: existingArtist,
      },
      { status: 409 },
    );
  }

  // Create new artist
  const artist = await prisma.artist.create({
    data: {
      name: result.data.name,
      normalizedName,
    },
  });

  return Response.json({ artist });
}

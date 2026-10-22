import { data } from "react-router";
import { z } from "zod";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/create.ts";

const CreateArtistSchema = z.object({
  name: z.string().min(1, "Artist name is required").max(255),
});

function normalizeArtistName(name: string): string {
  return name.toLowerCase().trim();
}

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

  // Check if artist already exists
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

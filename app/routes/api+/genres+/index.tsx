import { data } from "react-router";
import { z } from "zod";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { normalizeGenreName } from "#app/utils/genre-migration.server.ts";
import { type Route } from "./+types/index.ts";

const CreateGenreSchema = z.object({
  name: z.string().min(1, "Genre name is required").max(100),
});

export async function clientLoader(args: Route.ClientLoaderArgs) {
  // Genres are public and fetched via loader, no client-side override needed
  const response = await fetch("/api/genres");
  const data = await response.json();
  return data;
}

async function readActionData(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { error: response.statusText || "Request failed" };
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  // Proxy POST requests to server for curator/admin authentication.
  // 4xx bodies are action data so the genres page can show them inline.
  // Throwing the Response replaces Genre Management with the error boundary.
  const { request } = args;
  const body = await request.json();

  const response = await fetch("/api/genres", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // Includes 409/4xx bodies. Returning them keeps the genres page mounted.
  return readActionData(response);
}

/**
 * GET /api/genres
 * List all genres with track counts
 */
export async function loader({ request }: Route.LoaderArgs) {
  // Genres are public, no auth required for viewing

  // Get all genres with track counts
  const genres = await prisma.genre.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          tracks: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  // Transform to include trackCount
  const genresWithCounts = genres.map((genre) => ({
    id: genre.id,
    name: genre.name,
    trackCount: genre._count.tracks,
    createdAt: genre.createdAt,
  }));

  return Response.json({ genres: genresWithCounts });
}

/**
 * POST /api/genres
 * Create a new genre
 */
export async function action({ request }: Route.ActionArgs) {
  await requireCuratorOrAdmin(request);

  if (request.method !== "POST") {
    throw data({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const result = CreateGenreSchema.safeParse(body);

  if (!result.success) {
    throw data(
      {
        error: "Validation failed",
        details: result.error.issues,
      },
      { status: 400 },
    );
  }

  const normalizedName = normalizeGenreName(result.data.name);

  // Check if genre already exists
  const existingGenre = await prisma.genre.findFirst({
    where: { normalizedName },
  });

  if (existingGenre) {
    throw data(
      {
        error: "Genre already exists",
        genre: existingGenre,
      },
      { status: 409 },
    );
  }

  // Create new genre
  const genre = await prisma.genre.create({
    data: {
      name: result.data.name,
      normalizedName,
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          tracks: true,
        },
      },
    },
  });

  return Response.json({
    genre: {
      id: genre.id,
      name: genre.name,
      trackCount: genre._count.tracks,
      createdAt: genre.createdAt,
    },
  });
}

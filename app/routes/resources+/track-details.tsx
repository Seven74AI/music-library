import { data } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/track-details.ts";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId");

  if (!trackId) {
    throw new Response("Missing trackId", { status: 400 });
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      artist: {
        select: {
          id: true,
          name: true,
        },
      },
      duration: true,
      createdAt: true,
      coverImage: {
        select: {
          objectKey: true,
        },
      },
      service: {
        select: {
          displayName: true,
        },
      },
      serviceUrl: true,
    },
  });

  if (!track) {
    throw new Response("Track not found", { status: 404 });
  }

  return data({ track });
}

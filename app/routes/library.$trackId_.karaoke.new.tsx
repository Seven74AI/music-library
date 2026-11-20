import { data } from "react-router";
import { CreateKaraokeForm } from "#app/components/karaoke/create-karaoke-form.tsx";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/library.$trackId_.karaoke.new.ts";

/** Create-karaoke page for one track (track is fixed by the URL). */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);
  const track = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: { id: true, title: true, lyrics: true, artist: { select: { name: true } } },
  });
  if (!track) throw data("Track not found", { status: 404 });
  return {
    track: {
      id: track.id,
      title: track.title,
      artist: track.artist.name,
      lyrics: track.lyrics ?? null,
    },
  };
}

export default function NewKaraokeRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Create karaoke version</h1>
      <CreateKaraokeForm track={loaderData.track} />
    </div>
  );
}

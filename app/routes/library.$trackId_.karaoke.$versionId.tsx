import { data, Link, useRevalidator } from "react-router";
import { useEffect } from "react";
import { KaraokeEditor } from "#app/components/karaoke/karaoke-editor.tsx";
import { loadEditorVersion } from "#app/features/karaoke-generation/versions.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/library.$trackId_.karaoke.$versionId.ts";

/** Karaoke editor + version history for one version of a track. */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserId(request);
  const track = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: { id: true, title: true, artist: { select: { name: true } } },
  });
  if (!track) throw data("Track not found", { status: 404 });
  const version = await loadEditorVersion(track.id, params.versionId);
  if (!version) throw data("Version not found", { status: 404 });
  const [versions, pointer] = await Promise.all([
    prisma.trackKaraokeVersion.findMany({
      where: { trackId: track.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdBy: true,
        createdAt: true,
        language: true,
        source: true,
      },
    }),
    prisma.trackKaraoke.findUnique({
      where: { trackId: track.id },
      select: { currentVersionId: true },
    }),
  ]);
  return {
    track: { id: track.id, title: track.title, artist: track.artist.name },
    version,
    versions: versions.map((v) => ({
      id: v.id,
      status: v.status,
      createdBy: v.createdBy,
      language: v.language,
      source: v.source,
      createdAt: v.createdAt.toISOString(),
    })),
    currentVersionId: pointer?.currentVersionId ?? null,
  };
}

export default function KaraokeEditorRoute({ loaderData }: Route.ComponentProps) {
  const { track, version, versions, currentVersionId } = loaderData;
  const revalidator = useRevalidator();
  const generating =
    version.jobStatus !== null &&
    version.jobStatus !== "completed" &&
    version.jobStatus !== "failed";

  // Poll while the generation job is running so the page updates itself.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => void revalidator.revalidate(), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revalidator identity changes every render
  }, [generating]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <Link className="text-sm underline" to={`/library/${track.id}`}>
          ← {track.title}
        </Link>
        <h1 className="text-xl font-semibold">
          Karaoke editor — {track.title} · {track.artist}
        </h1>
      </div>
      <KaraokeEditor
        key={`${version.id}:${version.jobStatus}`}
        trackId={track.id}
        version={version}
        versions={versions}
        currentVersionId={currentVersionId}
      />
    </div>
  );
}

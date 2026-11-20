import { data, type LoaderFunctionArgs } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/** GET ?trackId=… → version metadata (no `lines`), newest first. */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireUserId(request);
  const trackId = new URL(request.url).searchParams.get("trackId");
  if (!trackId) {
    return data(
      { success: false, error: "trackId is required" },
      { status: 400 },
    );
  }
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true },
  });
  if (!track) {
    return data({ success: false, error: "Track not found" }, { status: 404 });
  }
  const [versions, pointer] = await Promise.all([
    prisma.trackKaraokeVersion.findMany({
      where: { trackId },
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
      where: { trackId },
      select: { currentVersionId: true },
    }),
  ]);
  return data({
    success: true,
    currentVersionId: pointer?.currentVersionId ?? null,
    versions,
  });
}

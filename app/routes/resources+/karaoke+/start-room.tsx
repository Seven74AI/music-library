import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { createRoom, endRoom, PartyRoomError } from "#app/features/party-room/party-room.server.ts";
import { addTrackToQueue } from "#app/features/party-room/queue.server.ts";
import { hasReadyKaraokeVersion } from "#app/features/track-video/karaoke-ready.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/start-room.ts";

const StartRoomSchema = z.object({ trackId: z.string().min(1) });

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Create a karaoke room, enqueue the track as host, return the room code. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const parsed = StartRoomSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    return data({ success: false, error: "trackId required" }, { status: 400 });
  }
  const { trackId } = parsed.data;

  const karaoke = await prisma.trackKaraoke.findUnique({
    where: { trackId },
    select: { currentVersion: { select: { status: true, videoFileId: true } } },
  });
  if (!hasReadyKaraokeVersion(karaoke?.currentVersion)) {
    return data(
      { success: false, error: "This track has no ready karaoke version" },
      { status: 400 },
    );
  }
  const audio = await prisma.trackAudioFile.findFirst({
    where: { trackId },
    select: { id: true },
  });
  if (!audio) {
    return data({ success: false, error: "Track has no audio file" }, { status: 400 });
  }

  let room: Awaited<ReturnType<typeof createRoom>> | undefined;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });
    const displayName = user?.name?.trim() || user?.username || "Host";
    room = await createRoom({ userId, displayName, kind: "karaoke" });
    await addTrackToQueue({ roomId: room.id, actor: { type: "user", userId }, trackId });
    return data({ success: true, code: room.code });
  } catch (error) {
    if (room) {
      try {
        await endRoom({ roomId: room.id, actor: { type: "user", userId } });
      } catch {
        // Best-effort cleanup; never mask the original error.
      }
    }
    if (error instanceof PartyRoomError) {
      return data({ success: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}

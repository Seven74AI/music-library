import { findOpenRoomByCode } from "#app/features/party-room/party-room.server.ts";
import {
  addPlaylistToQueue,
  addTrackToQueue,
  removeQueueItem,
  reorderUpcoming,
  setTransport,
  skipNext,
  skipToIndex,
} from "#app/features/party-room/queue.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import {
  partyRoomErrorResponse,
  readJsonBody,
  resolveActor,
} from "#app/features/party-room/request.server.ts";
import { type Route } from "./+types/$roomCode.queue.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { roomCode?: string };
}) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const code = params.roomCode?.toUpperCase();
    if (!code) {
      return Response.json({ error: "Room code required" }, { status: 400 });
    }
    const room = await findOpenRoomByCode(code);
    const actor = await resolveActor(request);
    const body = await readJsonBody(request);
    const intent = typeof body.intent === "string" ? body.intent : "";

    switch (intent) {
      case "add_track": {
        if (typeof body.trackId !== "string") {
          return Response.json({ error: "trackId required" }, { status: 400 });
        }
        const snapshot = await addTrackToQueue({
          roomId: room.id,
          actor,
          trackId: body.trackId,
        });
        return Response.json(snapshot);
      }
      case "add_playlist": {
        if (typeof body.playlistId !== "string") {
          return Response.json({ error: "playlistId required" }, { status: 400 });
        }
        const result = await addPlaylistToQueue({
          roomId: room.id,
          actor,
          playlistId: body.playlistId,
        });
        return Response.json(result);
      }
      case "remove": {
        if (typeof body.queueItemId !== "string") {
          return Response.json({ error: "queueItemId required" }, { status: 400 });
        }
        const snapshot = await removeQueueItem({
          roomId: room.id,
          actor,
          queueItemId: body.queueItemId,
        });
        return Response.json(snapshot);
      }
      case "reorder": {
        if (
          !Array.isArray(body.orderedUpcomingIds) ||
          !body.orderedUpcomingIds.every((id) => typeof id === "string")
        ) {
          return Response.json({ error: "orderedUpcomingIds required" }, { status: 400 });
        }
        const snapshot = await reorderUpcoming({
          roomId: room.id,
          actor,
          orderedUpcomingIds: body.orderedUpcomingIds as string[],
        });
        return Response.json(snapshot);
      }
      case "play":
      case "pause": {
        const snapshot = await setTransport({
          roomId: room.id,
          actor,
          isPlaying: intent === "play",
        });
        return Response.json(snapshot);
      }
      case "skip": {
        const snapshot = await skipNext({ roomId: room.id, actor });
        return Response.json(snapshot);
      }
      case "jump": {
        if (typeof body.index !== "number") {
          return Response.json({ error: "index required" }, { status: 400 });
        }
        const snapshot = await skipToIndex({
          roomId: room.id,
          actor,
          index: body.index,
        });
        return Response.json(snapshot);
      }
      default:
        return Response.json(
          { error: "Unknown intent", code: "invalid_queue_op" },
          { status: 400 },
        );
    }
  } catch (error) {
    return partyRoomErrorResponse(error);
  }
}

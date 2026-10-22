import { remember } from "@epic-web/remember";

type RoomSseController = ReadableStreamDefaultController<Uint8Array>;

const roomConnections = remember(
  "party-room-sse-connections",
  () => new Map<string, Set<RoomSseController>>(),
);

const encoder = new TextEncoder();

export function subscribeRoomEvents(roomId: string, controller: RoomSseController): () => void {
  let set = roomConnections.get(roomId);
  if (!set) {
    set = new Set();
    roomConnections.set(roomId, set);
  }
  set.add(controller);

  return () => {
    set?.delete(controller);
    if (set && set.size === 0) {
      roomConnections.delete(roomId);
    }
  };
}

export function roomSubscriberCount(roomId: string): number {
  return roomConnections.get(roomId)?.size ?? 0;
}

function enqueueSafe(controller: RoomSseController, chunk: Uint8Array) {
  try {
    controller.enqueue(chunk);
  } catch {
    // Client disconnected
  }
}

export function publishRoomEvent(roomId: string, payload: unknown): void {
  const connections = roomConnections.get(roomId);
  if (!connections || connections.size === 0) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const chunk = encoder.encode(data);
  for (const controller of connections) {
    enqueueSafe(controller, chunk);
  }
}

export function encodeSseComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`);
}

export function encodeSseData(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Test helper — drop all SSE subscribers. */
export function resetRoomSseConnections(): void {
  roomConnections.clear();
}

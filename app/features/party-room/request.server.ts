import { getUserId } from "#app/utils/auth.server.ts";
import { readGuestToken } from "./guest-token.server.ts";
import { PartyRoomError, type ParticipantActor } from "./party-room.server.ts";

export async function resolveOptionalUserId(request: Request): Promise<string | null> {
  try {
    return await getUserId(request);
  } catch (error) {
    if (error instanceof Response) return null;
    throw error;
  }
}

export async function resolveActor(request: Request): Promise<ParticipantActor> {
  const userId = await resolveOptionalUserId(request);
  if (userId) return { type: "user", userId };

  const guestToken = await readGuestToken(request);
  if (guestToken) return { type: "guest", guestToken };

  throw new PartyRoomError("unauthorized", "Authentication or guest token required", 401);
}

export function partyRoomErrorResponse(error: unknown): Response {
  if (error instanceof PartyRoomError) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (error.retryAfterSeconds) {
      headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  }
  throw error;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

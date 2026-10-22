import {
  getPlayerState,
  parsePlayerState,
  savePlayerState,
} from "#app/features/player-state/player-state.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/player-state.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const state = await getPlayerState(userId);
  if (!state) {
    return new Response(null, { status: 204 });
  }

  return Response.json(state);
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  if (request.method !== "PUT") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parsePlayerState(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid player state" }, { status: 400 });
  }

  await savePlayerState(userId, parsed.data);

  return Response.json({ ok: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

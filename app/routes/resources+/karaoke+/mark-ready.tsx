import { type ActionFunctionArgs } from "react-router";
import { publishVersionAction } from "#app/features/karaoke-generation/versions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/mark-ready.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Publish: mark the version ready and CAS-repoint TrackKaraoke.currentVersionId. */
export async function action({ request }: ActionFunctionArgs) {
  return publishVersionAction(request);
}

import { type ActionFunctionArgs } from "react-router";
import { publishVersionAction } from "#app/features/karaoke-generation/versions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/restore.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Restore a historic version (same semantics as mark-ready, shared action). */
export async function action({ request }: ActionFunctionArgs) {
  return publishVersionAction(request);
}

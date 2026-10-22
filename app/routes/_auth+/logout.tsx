import { redirect } from "react-router";
import { logout } from "#app/utils/auth.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/logout.ts";

export async function loader() {
  return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  return logout({ request });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

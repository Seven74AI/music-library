import { data } from "react-router";
import {
  loadDuplicateDashboard,
  markDuplicateGroupIntentional,
  parseDuplicateFilter,
} from "#app/features/admin/duplicate-dashboard.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/duplicates.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");
  const filter = parseDuplicateFilter(url.searchParams.get("filter"));
  return data(await loadDuplicateDashboard(filter));
}

export async function action({ request, url }: Route.ActionArgs) {
  const userId = await requireUserWithRole(request, "admin");
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "mark-intentional") {
    throw data({ error: "Unknown intent" }, { status: 400 });
  }

  const groupKey = formData.get("groupKey");
  const groupType = formData.get("groupType");
  if (typeof groupKey !== "string" || groupKey.length === 0) {
    throw data({ error: "Missing group" }, { status: 400 });
  }
  if (groupType !== "exact" && groupType !== "similar") {
    throw data({ error: "Invalid group type" }, { status: 400 });
  }

  await markDuplicateGroupIntentional({
    groupKey,
    groupType,
    createdBy: userId,
  });

  const filter = parseDuplicateFilter(url.searchParams.get("filter"));
  return data({
    ok: true as const,
    ...(await loadDuplicateDashboard(filter)),
  });
}

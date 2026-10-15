import { data, Outlet, type MiddlewareFunction } from "react-router";
import { OfflineAwareErrorBoundary } from "#app/components/offline/offline-aware-error-boundary.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { sessionKey } from "#app/utils/auth.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";

const replicaCachePath = "/admin/cache/sqlite";

// Document requests and session-cookie calls require the admin role.
// Replica instances POST here with Authorization: Bearer and no session.
async function allowsReplicaCacheCommand(request: Request) {
  if (request.method !== "POST") return false;
  const pathname = new URL(request.url).pathname.replace(/\.data$/, "");
  if (pathname !== replicaCachePath) return false;
  const authSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  return authSession.get(sessionKey) == null;
}

async function requireAdminLayoutAccess(request: Request) {
  if (await allowsReplicaCacheCommand(request)) return;
  await requireUserWithRole(request, "admin");
}

export const middleware: MiddlewareFunction[] = [
  async ({ request }, next) => {
    await requireAdminLayoutAccess(request);
    return next();
  },
];

export async function loader({ request }: { request: Request }) {
  await requireAdminLayoutAccess(request);
  return data({});
}

export default function AdminLayout() {
  return (
    <OfflineRouteBlocker>
      <Outlet />
    </OfflineRouteBlocker>
  );
}

function AdminForbidden() {
  return <p>You must be an admin to view this page.</p>;
}

export function ErrorBoundary() {
  return <OfflineAwareErrorBoundary statusHandlers={{ 403: AdminForbidden }} />;
}

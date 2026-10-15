import { isRouteErrorResponse, useRouteError } from "react-router";
import { OfflineAwareErrorBoundary } from "#app/components/offline/offline-aware-error-boundary.tsx";

function isAdminRoleError(data: unknown) {
  return (
    typeof data === "object" &&
    data !== null &&
    "requiredRole" in data &&
    data.requiredRole === "admin"
  );
}

// Middleware throws before loaders run. React Router then attaches that error
// to the first route with a loader (the root), so the admin layout boundary
// never renders for a document request.
export function RootErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403 && isAdminRoleError(error.data)) {
    return (
      <div className="text-h2 container flex items-center justify-center p-20">
        <p>You must be an admin to view this page.</p>
      </div>
    );
  }

  return <OfflineAwareErrorBoundary />;
}

import { Outlet } from "react-router";
import { type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { useOptionalUser } from "#app/utils/user.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: (
    <Icon name="speaker-wave" size="md">
      Rooms
    </Icon>
  ),
};

/**
 * Layout for /rooms* — no auth here so guests can open /rooms/:code join links.
 * Logged-in hub chrome lives on rooms.index; guest shell owns its own layout.
 */
export default function RoomsLayout() {
  const user = useOptionalUser();

  // Guests render the minified shell from rooms.$code without hub padding.
  if (!user) {
    return <Outlet />;
  }

  return (
    <main className="container py-8 pb-24">
      <Outlet />
    </main>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}

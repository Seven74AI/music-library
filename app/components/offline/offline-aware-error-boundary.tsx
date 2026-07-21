import { type ReactElement } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { GeneralErrorBoundary, type StatusHandler } from "#app/components/error-boundary.tsx";
import { OfflineUnavailableView } from "#app/components/offline/offline-unavailable-view.tsx";
import { isOfflineEnvironment } from "#app/features/offline-app/is-offline-environment.ts";

export function shouldShowOfflineErrorFallback(error: unknown) {
  return isOfflineEnvironment() && !isRouteErrorResponse(error);
}

export function OfflineErrorFallback() {
  return (
    <main className="py-12">
      <OfflineUnavailableView
        title="Something went wrong"
        description="You're offline and this page couldn't load. Open Downloads to keep listening to saved music."
      />
    </main>
  );
}

export function OfflineAwareErrorBoundary({
  defaultStatusHandler,
  statusHandlers,
  unexpectedErrorHandler,
}: {
  defaultStatusHandler?: StatusHandler;
  statusHandlers?: Record<number, StatusHandler>;
  unexpectedErrorHandler?: (error: unknown) => ReactElement | null;
}) {
  const error = useRouteError();

  if (shouldShowOfflineErrorFallback(error)) {
    return (
      <div className="container flex items-center justify-center p-20">
        <OfflineErrorFallback />
      </div>
    );
  }

  return (
    <GeneralErrorBoundary
      defaultStatusHandler={defaultStatusHandler}
      statusHandlers={statusHandlers}
      unexpectedErrorHandler={unexpectedErrorHandler}
    />
  );
}

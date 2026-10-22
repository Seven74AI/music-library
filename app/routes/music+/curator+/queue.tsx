import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { QueueTable } from "#app/components/dashboard/queue-table.tsx";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/queue.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorRole(request);
  return {};
}

export default function CuratorQueuePage() {
  return (
    <div className="container mx-auto max-w-6xl overflow-x-hidden px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Review queue</h1>
        <p className="text-muted-foreground">
          Claim a report to work on it. Each card names the track, artist, or album and states the
          matter. Your claims are listed under My claims.
        </p>
      </div>
      <QueueTable />
    </div>
  );
}

function CuratorQueueForbidden() {
  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Curators only</h1>
      <p className="mt-2 text-muted-foreground">
        You need the curator or admin role to view the review queue.
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: CuratorQueueForbidden }} />;
}

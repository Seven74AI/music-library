import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Link, useLoaderData } from "react-router";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent } from "#app/components/ui/card.tsx";
import { listReviewQueue } from "#app/features/curator/review-queue.server.ts";
import {
  entityPath,
  entityTypeLabel,
  queueMatter,
  queueStatusLabel,
  resolutionLabel,
  type ReviewQueueListItem,
} from "#app/features/curator/review-queue.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { type Route } from "./+types/reports.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  const result = await listReviewQueue({
    status: "all",
    page: Number.isFinite(page) ? page : 1,
    reporterId: userId,
  });
  return data(result);
}

export default function ReportsPage() {
  const { items, page, totalPages } = useLoaderData<typeof loader>();

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">My reports</h1>
        <p className="text-muted-foreground">
          Reports and flags you filed. Each one names the track, artist, or album and states the
          matter. Curators work them from the review queue.
        </p>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            You have not filed a report yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReportCard key={item.id} item={item} />
          ))}
        </div>
      )}
      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/reports?page=${page - 1}`}>Previous</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/reports?page=${page + 1}`}>Next</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReportCard({ item }: { item: ReviewQueueListItem }) {
  const href = entityPath(item.entityType, item.entityId);
  const heading = (
    <span className="text-base font-medium">
      {entityTypeLabel(item.entityType)}: {item.entityDetails.name}
    </span>
  );

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{queueStatusLabel(item.status)}</Badge>
        </div>
        {href ? (
          <Link to={href} className="hover:underline">
            {heading}
          </Link>
        ) : (
          heading
        )}
        <p className="mt-2 text-sm">
          <span className="font-medium">Matter</span>{" "}
          <span className="text-muted-foreground">{queueMatter(item)}</span>
        </p>
        {item.resolution ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">Resolution:</span> {resolutionLabel(item.resolution)}
            {item.resolutionComment ? (
              <span className="text-muted-foreground"> — {item.resolutionComment}</span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

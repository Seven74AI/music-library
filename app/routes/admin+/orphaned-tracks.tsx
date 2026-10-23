import * as React from "react";
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, Link } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#app/components/ui/table.tsx";
import {
  getOrphanedTrackStats,
  getTracksWithoutAudio,
  getTracksWithFailedJobs,
  getOrphanedAudioFiles,
  getUnusedTracks,
  queueTracksForDownload,
  deleteTracks,
  cleanupOrphanedAudioFiles,
  filterTracksWithoutAudio,
  filterUnusedTracks,
  type TrackWithoutAudio,
  type TrackWithFailedJob,
  type OrphanedAudioFile,
  type UnusedTrack,
} from "#app/features/admin/orphaned-tracks.server.ts";
import { parsePageParam } from "#app/utils/parse-page-param.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/orphaned-tracks.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const TABS = ["missing-audio", "failed-downloads", "storage-orphans", "unused-tracks"] as const;
type TabType = (typeof TABS)[number];

type TabDataItem = TrackWithoutAudio | TrackWithFailedJob | OrphanedAudioFile | UnusedTrack;

const PAGE_SIZE = 50;

const FAILED_DOWNLOAD_ERROR_CATEGORIES = [
  "AUTH",
  "RATE_LIMITED",
  "GEO_BLOCKED",
  "VIDEO_UNAVAILABLE",
  "NETWORK",
  "COOKIE_EXPIRED",
  "FILE_NOT_FOUND",
  "FORMAT_UNAVAILABLE",
  "UNKNOWN",
] as const;

function orphanPageHref({
  tab,
  page,
  serviceFilter,
  errorCategoryFilter,
  ageFilter,
}: {
  tab: string;
  page: number;
  serviceFilter: string;
  errorCategoryFilter: string;
  ageFilter: string;
}) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (page > 1) params.set("page", String(page));
  if (tab === "missing-audio" && serviceFilter !== "all") params.set("service", serviceFilter);
  if (tab === "failed-downloads" && errorCategoryFilter !== "all") {
    params.set("errorCategory", errorCategoryFilter);
  }
  if (tab === "unused-tracks" && ageFilter !== "30d") params.set("age", ageFilter);
  return `?${params.toString()}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");

  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab") ?? "missing-audio";
  const tab: TabType = TABS.includes(tabParam as TabType) ? (tabParam as TabType) : "missing-audio";

  const page = parsePageParam(url.searchParams.get("page"));
  const serviceFilter = url.searchParams.get("service") ?? "all";
  const errorCategoryFilter = url.searchParams.get("errorCategory") ?? "all";
  const ageFilter = url.searchParams.get("age") ?? "30d";

  const ageDays =
    ageFilter === "7d" ? 7 : ageFilter === "90d" ? 90 : ageFilter === "all" ? null : 30;

  const stats = await getOrphanedTrackStats(ageDays);

  const skip = (page - 1) * PAGE_SIZE;
  let tabData: TabDataItem[] = [];
  let totalItems = 0;

  switch (tab) {
    case "missing-audio": {
      const result = await getTracksWithoutAudio(serviceFilter !== "all" ? serviceFilter : null, {
        skip,
        take: PAGE_SIZE,
      });
      tabData = result.items;
      totalItems = result.total;
      break;
    }
    case "failed-downloads": {
      const result = await getTracksWithFailedJobs(
        errorCategoryFilter !== "all" ? errorCategoryFilter : null,
        { skip, take: PAGE_SIZE },
      );
      tabData = result.items;
      totalItems = result.total;
      break;
    }
    case "storage-orphans": {
      const result = await getOrphanedAudioFiles({ skip, take: PAGE_SIZE });
      tabData = result.items;
      totalItems = result.total;
      break;
    }
    case "unused-tracks": {
      const result = await getUnusedTracks(ageDays, { skip, take: PAGE_SIZE });
      tabData = result.items;
      totalItems = result.total;
      break;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const paginatedData = tabData;

  return {
    stats,
    tab,
    tabData: paginatedData,
    page,
    totalPages,
    totalItems,
    serviceFilter,
    errorCategoryFilter,
    ageFilter,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireUserWithRole(request, "admin");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const tab = formData.get("tab");

  switch (intent) {
    case "queue-for-download": {
      const trackIds = formData
        .getAll("trackId")
        .filter((id): id is string => typeof id === "string");
      if (trackIds.length === 0) {
        return data({ success: false, error: "No tracks selected" }, { status: 400 });
      }
      // Defense-in-depth: only queue tracks that actually lack audio, so a
      // crafted POST cannot enqueue arbitrary tracks for (re)download.
      const validIds = await filterTracksWithoutAudio(trackIds);
      if (validIds.length === 0) {
        return data({ success: false, error: "No matching tracks selected" }, { status: 400 });
      }
      const queued = await queueTracksForDownload(validIds);
      return data({ success: true, action: "queue-for-download", count: queued });
    }

    case "delete-tracks": {
      const trackIds = formData
        .getAll("trackId")
        .filter((id): id is string => typeof id === "string");
      if (trackIds.length === 0) {
        return data({ success: false, error: "No tracks selected" }, { status: 400 });
      }
      // Defense-in-depth: only delete tracks matching the tab's semantic
      // criteria, so a crafted POST cannot delete non-orphaned/non-unused tracks.
      // `tab` is required: an omitted/unknown tab is rejected rather than
      // silently falling back to a different tab's filter.
      const validIds =
        tab === "unused-tracks"
          ? await filterUnusedTracks(trackIds)
          : tab === "missing-audio"
            ? await filterTracksWithoutAudio(trackIds)
            : null;
      if (validIds === null) {
        return data({ success: false, error: "Invalid tab for delete-tracks" }, { status: 400 });
      }
      if (validIds.length === 0) {
        return data({ success: false, error: "No matching tracks selected" }, { status: 400 });
      }
      const result = await deleteTracks(validIds);
      return data({ success: true, action: "delete-tracks", deleted: result.deleted });
    }

    case "cleanup-orphaned-files": {
      const fileIds = formData
        .getAll("fileId")
        .filter((id): id is string => typeof id === "string");
      if (fileIds.length === 0) {
        return data({ success: false, error: "No files selected" }, { status: 400 });
      }
      const result = await cleanupOrphanedAudioFiles(fileIds);
      return data({ success: true, action: "cleanup-orphaned-files", deleted: result.deleted });
    }

    default: {
      return data({ success: false, error: `Unknown intent: ${intent}` }, { status: 400 });
    }
  }
}

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString();
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

function ErrorBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    VIDEO_UNAVAILABLE: "bg-red-500",
    GEO_BLOCKED: "bg-orange-500",
    AUTH: "bg-yellow-500",
    COOKIE_EXPIRED: "bg-purple-500",
    UNKNOWN: "bg-gray-500",
  };

  const bgColor = colors[category] ?? colors.UNKNOWN;

  return (
    <Badge variant="outline" className={`${bgColor} text-white border-0`}>
      {category}
    </Badge>
  );
}

export default function OrphanedTracksRoute({ loaderData }: Route.ComponentProps) {
  const { stats, tab, tabData, page, totalPages, serviceFilter, errorCategoryFilter, ageFilter } =
    loaderData;

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    setSelectedIds([]);
  }, [tab]);

  // Bulk actions revalidate the loader without changing `tab`. Drop ids that
  // are no longer on the page so the hidden form cannot submit a removed row.
  React.useEffect(() => {
    setSelectedIds((current) => {
      if (current.length === 0) return current;
      const loadedIds = new Set(tabData.map((item) => item.id));
      const next = current.filter((id) => loadedIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [tabData]);

  // The effect above updates state after paint. Filter here so the toolbar and
  // hidden inputs drop removed rows in the same render as the reloaded list.
  const visibleSelectedIds = selectedIds.filter((id) => tabData.some((item) => item.id === id));

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (visibleSelectedIds.length === tabData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(tabData.map((item) => item.id));
    }
  };

  return (
    <div className="container py-8">
      <div>
        <h1 className="text-h1">Admin Orphaned Tracks</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Detect and manage tracks with missing data or orphaned storage
        </p>
      </div>

      <Spacer size="2xs" />

      <div className="flex gap-2 mb-6 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            to={`?tab=${t}`}
            className={`px-4 py-2 border-b-2 transition-colors ${
              tab === t
                ? "border-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "missing-audio" && "Missing Audio"}
            {t === "failed-downloads" && "Failed Downloads"}
            {t === "storage-orphans" && "Storage Orphans"}
            {t === "unused-tracks" && "Unused Tracks"}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Missing Audio</CardDescription>
            <CardTitle className="text-2xl">{stats.missingAudio}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed Downloads</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.failedDownloads}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Orphaned Files</CardDescription>
            <CardTitle className="text-2xl">{stats.storageOrphans}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Storage Waste</CardDescription>
            <CardTitle className="text-2xl">{stats.storageWasteMB} MB</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            {visibleSelectedIds.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {visibleSelectedIds.length} selected
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {tab === "missing-audio" && (
              <Form method="get" className="flex gap-2">
                <input type="hidden" name="tab" value={tab} />
                <select
                  name="service"
                  aria-label="Service"
                  defaultValue={serviceFilter}
                  className="border-input bg-background h-9 w-36 rounded-md border px-2 text-sm"
                >
                  <option value="all">All Services</option>
                  <option value="youtube">YouTube</option>
                  <option value="local">Local</option>
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Filter
                </Button>
              </Form>
            )}

            {tab === "failed-downloads" && (
              <Form method="get" className="flex gap-2">
                <input type="hidden" name="tab" value={tab} />
                <select
                  name="errorCategory"
                  aria-label="Error category"
                  defaultValue={errorCategoryFilter}
                  className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                >
                  <option value="all">All categories</option>
                  {FAILED_DOWNLOAD_ERROR_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Filter
                </Button>
              </Form>
            )}

            {tab === "unused-tracks" && (
              <Form method="get" className="flex gap-2">
                <input type="hidden" name="tab" value={tab} />
                <select
                  name="age"
                  aria-label="Age"
                  defaultValue={ageFilter}
                  className="border-input bg-background h-9 w-36 rounded-md border px-2 text-sm"
                >
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="90d">90 days</option>
                  <option value="all">All</option>
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Filter
                </Button>
              </Form>
            )}

            {tab === "missing-audio" && visibleSelectedIds.length > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="queue-for-download" />
                <input type="hidden" name="tab" value={tab} />
                {visibleSelectedIds.map((id) => (
                  <input key={id} type="hidden" name="trackId" value={id} />
                ))}
                <Button type="submit" variant="default" size="sm">
                  <Icon name="download" className="mr-1" />
                  Queue for Download
                </Button>
              </Form>
            )}

            {(tab === "missing-audio" || tab === "unused-tracks") &&
              visibleSelectedIds.length > 0 && (
                <Form method="post">
                  <input type="hidden" name="intent" value="delete-tracks" />
                  <input type="hidden" name="tab" value={tab} />
                  {visibleSelectedIds.map((id) => (
                    <input key={id} type="hidden" name="trackId" value={id} />
                  ))}
                  <Button type="submit" variant="destructive" size="sm">
                    <Icon name="trash" className="mr-1" />
                    Delete Selected
                  </Button>
                </Form>
              )}

            {tab === "storage-orphans" && visibleSelectedIds.length > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="cleanup-orphaned-files" />
                <input type="hidden" name="tab" value={tab} />
                {visibleSelectedIds.map((id) => (
                  <input key={id} type="hidden" name="fileId" value={id} />
                ))}
                <Button type="submit" variant="destructive" size="sm">
                  <Icon name="trash" className="mr-1" />
                  Clean Up Storage
                </Button>
              </Form>
            )}
          </div>
        </div>

        {tab === "missing-audio" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={visibleSelectedIds.length === tabData.length && tabData.length > 0}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Track</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No tracks without audio files found.
                  </TableCell>
                </TableRow>
              ) : (
                (tabData as TrackWithoutAudio[]).map((track) => (
                  <TableRow key={track.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={visibleSelectedIds.includes(track.id)}
                        onChange={() => toggleSelection(track.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{track.title}</TableCell>
                    <TableCell>{track.artistName}</TableCell>
                    <TableCell>{track.serviceDisplayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(track.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {tab === "failed-downloads" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Track</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Last Attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No failed downloads found.
                  </TableCell>
                </TableRow>
              ) : (
                (tabData as TrackWithFailedJob[]).map((track) => (
                  <TableRow key={track.id}>
                    <TableCell className="font-medium">{track.title}</TableCell>
                    <TableCell>{track.artistName}</TableCell>
                    <TableCell>
                      <ErrorBadge category={track.errorCategory} />
                    </TableCell>
                    <TableCell className="font-mono">{track.retryCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(track.lastAttemptAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {tab === "storage-orphans" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={visibleSelectedIds.length === tabData.length && tabData.length > 0}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Object Key</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>File Size</TableHead>
                <TableHead>Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No orphaned files found.
                  </TableCell>
                </TableRow>
              ) : (
                (tabData as OrphanedAudioFile[]).map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={visibleSelectedIds.includes(file.id)}
                        onChange={() => toggleSelection(file.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{file.objectKey}</TableCell>
                    <TableCell>{file.format ?? "—"}</TableCell>
                    <TableCell>{formatBytes(file.fileSize)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(file.uploadedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {tab === "unused-tracks" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={visibleSelectedIds.length === tabData.length && tabData.length > 0}
                    onChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Track</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No unused tracks found.
                  </TableCell>
                </TableRow>
              ) : (
                (tabData as UnusedTrack[]).map((track) => (
                  <TableRow key={track.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={visibleSelectedIds.includes(track.id)}
                        onChange={() => toggleSelection(track.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{track.title}</TableCell>
                    <TableCell>{track.artistName}</TableCell>
                    <TableCell>{track.serviceDisplayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(track.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={orphanPageHref({
                      tab,
                      page: page - 1,
                      serviceFilter,
                      errorCategoryFilter,
                      ageFilter,
                    })}
                  >
                    <Icon name="chevron-double-left" />
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  <Icon name="chevron-double-left" />
                  Previous
                </Button>
              )}
              {page < totalPages ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={orphanPageHref({
                      tab,
                      page: page + 1,
                      serviceFilter,
                      errorCategoryFilter,
                      ageFilter,
                    })}
                  >
                    Next
                    <Icon name="chevron-double-right" />
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  Next
                  <Icon name="chevron-double-right" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrphanedTracks403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: OrphanedTracks403 }} />;
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

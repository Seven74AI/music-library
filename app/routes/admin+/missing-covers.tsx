// Admin dashboard for detecting and managing tracks/albums with missing cover images
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { data, Form, Link, useSearchParams } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
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
  countAlbumsWithoutCovers,
  countTracksWithoutCovers,
  getAlbumsWithoutCovers,
  getCoverStatistics,
  getTracksWithoutCovers,
  inheritCoverFromTrack,
  retryAllFailedFetches,
  retryFetchCover,
  uploadAlbumCover,
  uploadTrackCover,
} from "#app/features/admin/cover-fetch.server";
import { coverImageUrl } from "#app/utils/cover-image-url";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/missing-covers.ts";

export const handle: SEOHandle = { getSitemapEntries: () => null };

const TABS = ["tracks", "albums"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");
  const tabParam = url.searchParams.get("tab") ?? "tracks";
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "tracks";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

  const [statistics, tracksCount, albumsCount] = await Promise.all([
    getCoverStatistics(),
    countTracksWithoutCovers(),
    countAlbumsWithoutCovers(),
  ]);

  let tracks: Awaited<ReturnType<typeof getTracksWithoutCovers>> = [];
  let albums: Awaited<ReturnType<typeof getAlbumsWithoutCovers>> = [];
  let totalPages = 1;

  if (tab === "tracks") {
    tracks = await getTracksWithoutCovers({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    totalPages = Math.max(1, Math.ceil(tracksCount / PAGE_SIZE));
  } else {
    albums = await getAlbumsWithoutCovers({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    totalPages = Math.max(1, Math.ceil(albumsCount / PAGE_SIZE));
  }

  const albumsWithUrls = albums.map((album) => ({
    ...album,
    tracksWithCoverUrls: album.tracksWithCovers
      .map((track) => {
        if (!track.coverImage) return null;
        return {
          trackId: track.id,
          trackTitle: track.title,
          coverImageId: track.coverImageId,
          coverUrl: coverImageUrl(track.coverImage.objectKey, 80),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  }));

  return {
    statistics,
    tracksCount,
    albumsCount,
    tracks,
    albums: albumsWithUrls,
    tab,
    page,
    totalPages,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireUserWithRole(request, "admin");
  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "retry-all": {
      const result = await retryAllFailedFetches();
      return data({ success: true, action: "retry-all", queued: result.queued });
    }
    case "retry-track": {
      const trackId = formData.get("trackId");
      if (typeof trackId !== "string")
        return data({ success: false, error: "Missing trackId" }, { status: 400 });
      const result = await retryFetchCover(trackId);
      return data({ success: result.success, action: "retry-track", error: result.error });
    }
    case "upload-track": {
      const trackId = formData.get("trackId");
      const file = formData.get("file");
      if (typeof trackId !== "string")
        return data({ success: false, error: "Missing trackId" }, { status: 400 });
      if (!(file instanceof File))
        return data({ success: false, error: "Missing file" }, { status: 400 });
      if (file.size > MAX_FILE_SIZE)
        return data({ success: false, error: "File size exceeds 5MB limit" }, { status: 400 });
      if (!ALLOWED_TYPES.includes(file.type))
        return data(
          { success: false, error: "Invalid file type. Use JPG, PNG, WebP, or GIF" },
          { status: 400 },
        );
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await uploadTrackCover(trackId, buffer);
      return data({ success: result.success, action: "upload-track", error: result.error });
    }
    case "upload-album": {
      const albumId = formData.get("albumId");
      const file = formData.get("file");
      if (typeof albumId !== "string")
        return data({ success: false, error: "Missing albumId" }, { status: 400 });
      if (!(file instanceof File))
        return data({ success: false, error: "Missing file" }, { status: 400 });
      if (file.size > MAX_FILE_SIZE)
        return data({ success: false, error: "File size exceeds 5MB limit" }, { status: 400 });
      if (!ALLOWED_TYPES.includes(file.type))
        return data(
          { success: false, error: "Invalid file type. Use JPG, PNG, WebP, or GIF" },
          { status: 400 },
        );
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await uploadAlbumCover(albumId, buffer);
      return data({ success: result.success, action: "upload-album", error: result.error });
    }
    case "inherit-from-track": {
      const albumId = formData.get("albumId");
      const trackId = formData.get("trackId");
      if (typeof albumId !== "string" || typeof trackId !== "string")
        return data({ success: false, error: "Missing albumId or trackId" }, { status: 400 });
      const result = await inheritCoverFromTrack(albumId, trackId);
      return data({ success: result.success, action: "inherit-from-track", error: result.error });
    }
    default:
      return data({ success: false, error: `Unknown intent: ${intent}` }, { status: 400 });
  }
}

function formatAge(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export default function MissingCoversRoute({ loaderData, actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") ?? "tracks") as Tab;
  const { statistics, tracksCount, albumsCount, tracks, albums, page, totalPages } = loaderData;
  const actionError =
    actionData && "error" in actionData && actionData.error ? actionData.error : null;

  return (
    <div className="container py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-h1">Admin Cover Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Monitor and improve cover image quality.{" "}
            <Link to="/admin" className="underline">
              Back to admin
            </Link>
          </p>
        </div>
      </div>
      {actionError ? (
        <p className="text-destructive mb-4 text-sm" role="alert">
          {actionError}
        </p>
      ) : null}
      <Spacer size="sm" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tracks Without Covers</CardDescription>
            <CardTitle className="text-2xl">{tracksCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {statistics.totalTracks > 0
              ? `${Math.round((tracksCount / statistics.totalTracks) * 100)}% missing`
              : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Albums Without Covers</CardDescription>
            <CardTitle className="text-2xl">{albumsCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overall Coverage</CardDescription>
            <CardTitle className="text-2xl">{statistics.coveragePercentage}%</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {statistics.tracksWithCovers} / {statistics.totalTracks}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tracks</CardDescription>
            <CardTitle className="text-2xl">{statistics.totalTracks}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {statistics.serviceStats.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Coverage by Service</CardTitle>
            <CardDescription>Cover image availability by music source</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {statistics.serviceStats.map((service) => (
                <div key={service.serviceId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{service.serviceName}</span>
                    <span className="text-muted-foreground">
                      {service.tracksWithCovers} / {service.totalTracks} (
                      {service.coveragePercentage}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${service.coveragePercentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="border-b mb-6">
        <div className="flex gap-4">
          <Form method="get">
            <input type="hidden" name="tab" value="tracks" />
            <Button
              type="submit"
              variant={activeTab === "tracks" ? "default" : "ghost"}
              className="rounded-b-none"
            >
              Tracks ({tracksCount})
            </Button>
          </Form>
          <Form method="get">
            <input type="hidden" name="tab" value="albums" />
            <Button
              type="submit"
              variant={activeTab === "albums" ? "default" : "ghost"}
              className="rounded-b-none"
            >
              Albums ({albumsCount})
            </Button>
          </Form>
        </div>
      </div>

      <div className="rounded-lg border p-6">
        {activeTab === "tracks" ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-h3">Tracks Without Covers</h2>
              <Form method="post">
                <Button type="submit" name="intent" value="retry-all" variant="default">
                  <Icon name="arrow-path" className="mr-2" />
                  Retry All Failed Fetches
                </Button>
              </Form>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cover</TableHead>
                  <TableHead>Track</TableHead>
                  <TableHead>Artist</TableHead>
                  <TableHead>Album</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No tracks without covers found. Great job!
                    </TableCell>
                  </TableRow>
                ) : (
                  tracks.map((track) => (
                    <TableRow key={track.id}>
                      <TableCell>
                        <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                          🎵
                        </div>
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {track.title}
                      </TableCell>
                      <TableCell>{track.artistName}</TableCell>
                      <TableCell>{track.albumName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{track.serviceName}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatAge(track.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {track.thumbnailUrl && (
                            <Form method="post" className="inline">
                              <input type="hidden" name="trackId" value={track.id} />
                              <Button
                                type="submit"
                                name="intent"
                                value="retry-track"
                                variant="outline"
                                size="sm"
                              >
                                <Icon name="arrow-path" className="mr-1" />
                                Fetch
                              </Button>
                            </Form>
                          )}
                          <Form method="post" encType="multipart/form-data" className="inline">
                            <input type="hidden" name="trackId" value={track.id} />
                            <input
                              type="file"
                              name="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              className="hidden"
                              id={`upload-track-${track.id}`}
                              onChange={(e) => {
                                const form = e.currentTarget.form;
                                if (form && e.currentTarget.files?.length) {
                                  const submitBtn = form.querySelector(
                                    'button[name="intent"]',
                                  ) as HTMLButtonElement;
                                  submitBtn?.click();
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                document.getElementById(`upload-track-${track.id}`)?.click();
                              }}
                            >
                              Upload
                            </Button>
                            <button
                              type="submit"
                              name="intent"
                              value="upload-track"
                              className="hidden"
                            />
                          </Form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Form method="get">
                    <input type="hidden" name="tab" value="tracks" />
                    {page > 1 && <input type="hidden" name="page" value={page - 1} />}
                    <Button type="submit" variant="outline" size="sm" disabled={page <= 1}>
                      <Icon name="chevron-double-left" />
                      Previous
                    </Button>
                  </Form>
                  <Form method="get">
                    <input type="hidden" name="tab" value="tracks" />
                    {page < totalPages && <input type="hidden" name="page" value={page + 1} />}
                    <Button type="submit" variant="outline" size="sm" disabled={page >= totalPages}>
                      Next
                      <Icon name="chevron-double-right" />
                    </Button>
                  </Form>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="text-h3 mb-4">Albums Without Covers</h2>
            <div className="space-y-6">
              {albums.length === 0 ? (
                <Card>
                  <CardContent className="text-center text-muted-foreground py-8">
                    No albums without covers found. Great job!
                  </CardContent>
                </Card>
              ) : (
                albums.map((album) => (
                  <Card key={album.id}>
                    <CardHeader>
                      <CardTitle>{album.name}</CardTitle>
                      <CardDescription>
                        by {album.artistName} · {album.trackCount} tracks ·{" "}
                        {album.tracksWithCovers.length} with covers
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {album.tracksWithCoverUrls.length > 0 && (
                          <div className="w-full mb-4">
                            <p className="text-sm font-medium mb-2">
                              Available covers from tracks:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {album.tracksWithCoverUrls.map((track) => (
                                <Form method="post" key={track.trackId} className="inline-block">
                                  <input type="hidden" name="albumId" value={album.id} />
                                  <input type="hidden" name="trackId" value={track.trackId} />
                                  <button
                                    type="submit"
                                    name="intent"
                                    value="inherit-from-track"
                                    className="block"
                                  >
                                    <img
                                      src={track.coverUrl}
                                      alt={track.trackTitle}
                                      className="w-20 h-20 rounded border-2 border-transparent hover:border-primary transition-colors cursor-pointer"
                                      title={`Use cover from "${track.trackTitle}"`}
                                    />
                                  </button>
                                </Form>
                              ))}
                            </div>
                          </div>
                        )}
                        <Form method="post" encType="multipart/form-data" className="inline">
                          <input type="hidden" name="albumId" value={album.id} />
                          <input
                            type="file"
                            name="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                            id={`upload-album-${album.id}`}
                            onChange={(e) => {
                              const form = e.currentTarget.form;
                              if (form && e.currentTarget.files?.length) {
                                const submitBtn = form.querySelector(
                                  'button[name="intent"]',
                                ) as HTMLButtonElement;
                                submitBtn?.click();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              document.getElementById(`upload-album-${album.id}`)?.click();
                            }}
                          >
                            Upload Cover
                          </Button>
                          <button
                            type="submit"
                            name="intent"
                            value="upload-album"
                            className="hidden"
                          />
                        </Form>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Form method="get">
                    <input type="hidden" name="tab" value="albums" />
                    {page > 1 && <input type="hidden" name="page" value={page - 1} />}
                    <Button type="submit" variant="outline" size="sm" disabled={page <= 1}>
                      <Icon name="chevron-double-left" />
                      Previous
                    </Button>
                  </Form>
                  <Form method="get">
                    <input type="hidden" name="tab" value="albums" />
                    {page < totalPages && <input type="hidden" name="page" value={page + 1} />}
                    <Button type="submit" variant="outline" size="sm" disabled={page >= totalPages}>
                      Next
                      <Icon name="chevron-double-right" />
                    </Button>
                  </Form>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Admin403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: Admin403 }} />;
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

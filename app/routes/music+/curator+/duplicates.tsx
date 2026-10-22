import { useState } from "react";
import { data, useLoaderData } from "react-router";
import { useCuratorFilterSession } from "#app/features/curator/use-curator-session.ts";
import { AlbumMergeDialog, type AlbumOption } from "#app/components/album-merge-dialog";
import { ArtistMergeDialog, type ArtistOption } from "#app/components/artist-merge-dialog";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { Button } from "#app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card";
import { Icon } from "#app/components/ui/icon";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/duplicates";

type DuplicatePayload = {
  exact: Array<Record<string, unknown>>;
  fuzzy: Array<Record<string, unknown>>;
};

// request.url follows X-Forwarded-Host. Keep this lookup on a configured origin
// and send only the session cookie, not the rest of the incoming headers.
function trustedDuplicatesUrl(pathname: string) {
  const configured = process.env.SITE_URL?.trim();
  const origin = configured
    ? configured.replace(/\/$/, "")
    : `http://127.0.0.1:${process.env.PORT || "3000"}`;
  return new URL(pathname, `${origin}/`).toString();
}

function sessionCookie(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("en_session=")) ?? null
  );
}

function isDuplicatePayload(value: unknown): value is DuplicatePayload {
  if (!value || typeof value !== "object") return false;
  const record = value as { exact?: unknown; fuzzy?: unknown };
  return Array.isArray(record.exact) && Array.isArray(record.fuzzy);
}

async function readDuplicatePayload(response: Response): Promise<DuplicatePayload> {
  if (!response.ok) {
    throw new Error(`Duplicate lookup failed with status ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("Duplicate lookup returned a non-JSON body", { cause: error });
  }
  if (!isDuplicatePayload(body)) {
    throw new Error("Duplicate lookup returned an unexpected payload");
  }
  return body;
}

async function fetchDuplicateGroups(pathname: string, cookie: string | null) {
  const response = await fetch(trustedDuplicatesUrl(pathname), {
    headers: cookie ? { cookie } : {},
  });
  return readDuplicatePayload(response);
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorRole(request);

  try {
    const cookie = sessionCookie(request);
    const [artistsData, albumsData] = await Promise.all([
      fetchDuplicateGroups("/api/curator/duplicates/artists", cookie),
      fetchDuplicateGroups("/api/curator/duplicates/albums", cookie),
    ]);

    const artistGroups = [
      ...artistsData.exact.map((group) => ({ ...group, matchType: "exact" as const })),
      ...artistsData.fuzzy.map((group) => ({ ...group, matchType: "fuzzy" as const })),
    ];

    const albumGroups = [
      ...albumsData.exact.map((group) => ({ ...group, matchType: "exact" as const })),
      ...albumsData.fuzzy.map((group) => ({ ...group, matchType: "fuzzy" as const })),
    ];

    return data({
      artistGroups,
      albumGroups,
    });
  } catch (error) {
    console.error("Error loading duplicates:", error);
    throw data({ error: "Failed to load duplicates" }, { status: 500 });
  }
}

export default function DuplicatesPage() {
  const { artistGroups, albumGroups } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<"both" | "artists" | "albums">("both");
  useCuratorFilterSession({
    page: "/music/curator/duplicates",
    filters: { filter },
    active: filter !== "both",
    onRestore: (state) => {
      const next = state.filters.filter;
      if (next === "both" || next === "artists" || next === "albums") setFilter(next);
    },
  });
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeType, setMergeType] = useState<"artist" | "album">("artist");
  const [mergeData, setMergeData] = useState<{
    source?: ArtistOption | AlbumOption;
    target?: ArtistOption | AlbumOption;
    artistName?: string;
  }>({});

  const showArtists = filter === "both" || filter === "artists";
  const showAlbums = filter === "both" || filter === "albums";

  const handleMergeArtists = (artists: ArtistOption[]) => {
    if (artists.length < 2) return;
    // Smart defaults: fewer tracks -> more tracks
    const sorted = [...artists].sort((a, b) => a.trackCount - b.trackCount);
    setMergeType("artist");
    setMergeData({
      source: sorted[0],
      target: sorted[sorted.length - 1],
    });
    setMergeDialogOpen(true);
  };

  const handleMergeAlbums = (albums: AlbumOption[], artistName: string) => {
    if (albums.length < 2) return;
    const sorted = [...albums].sort((a, b) => a.trackCount - b.trackCount);
    setMergeType("album");
    setMergeData({
      source: sorted[0],
      target: sorted[sorted.length - 1],
      artistName,
    });
    setMergeDialogOpen(true);
  };

  return (
    <div className="container mx-auto max-w-5xl overflow-x-hidden px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Duplicate Detection</h1>
        <p className="text-muted-foreground">
          Find and merge duplicate artists and albums to keep your library organized
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button
          variant={filter === "both" ? "default" : "outline"}
          onClick={() => setFilter("both")}
          className="min-h-11"
        >
          Both
        </Button>
        <Button
          variant={filter === "artists" ? "default" : "outline"}
          onClick={() => setFilter("artists")}
          className="min-h-11"
        >
          Artists Only
        </Button>
        <Button
          variant={filter === "albums" ? "default" : "outline"}
          onClick={() => setFilter("albums")}
          className="min-h-11"
        >
          Albums Only
        </Button>
      </div>

      <div className="space-y-8">
        {showArtists && artistGroups.length > 0 && (
          <>
            {artistGroups.filter((g: any) => g.matchType === "exact").length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-2">Exact Duplicate Artists</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  These artists have identical normalized names and are very likely duplicates
                </p>
                <div className="space-y-4">
                  {artistGroups
                    .filter((g: any) => g.matchType === "exact")
                    .map((group: any) => (
                      <Card key={`exact-${group.normalizedName}`}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <CardTitle className="text-base">
                                  {group.artists.map((a: any) => a.name).join(" / ")}
                                </CardTitle>
                                <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                                  Exact
                                </span>
                              </div>
                              <CardDescription>
                                {group.totalTracks} total tracks across {group.artists.length}{" "}
                                entries
                              </CardDescription>
                            </div>
                            <Button size="sm" onClick={() => handleMergeArtists(group.artists)}>
                              Merge These →
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {group.artists.map((artist: any, index: number) => (
                              <div
                                key={artist.id}
                                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="font-medium">{artist.name}</div>
                                  {index === 0 && (
                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                      Most Tracks
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {artist.trackCount} tracks, {artist.albumCount} albums
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            )}

            {artistGroups.filter((g: any) => g.matchType === "fuzzy").length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-2">Similar Artist Names (Fuzzy)</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  These artists have similar names and may be duplicates. Review carefully before
                  merging.
                </p>
                <div className="space-y-4">
                  {artistGroups
                    .filter((g: any) => g.matchType === "fuzzy")
                    .map((group: any) => (
                      <Card key={`fuzzy-${group.normalizedName}`}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <CardTitle className="text-base">
                                  {group.artists.map((a: any) => a.name).join(" / ")}
                                </CardTitle>
                                <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded">
                                  Fuzzy
                                </span>
                              </div>
                              <CardDescription>
                                {group.totalTracks} total tracks across {group.artists.length}{" "}
                                entries
                              </CardDescription>
                            </div>
                            <Button size="sm" onClick={() => handleMergeArtists(group.artists)}>
                              Merge These →
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {group.artists.map((artist: any, index: number) => (
                              <div
                                key={artist.id}
                                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="font-medium">{artist.name}</div>
                                  {index === 0 && (
                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                      Most Tracks
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {artist.trackCount} tracks, {artist.albumCount} albums
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            )}
          </>
        )}

        {showAlbums && albumGroups.length > 0 && (
          <>
            {albumGroups.filter((g: any) => g.matchType === "exact").length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-2">Exact Duplicate Albums</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  These albums have identical normalized names and are very likely duplicates
                </p>
                <div className="space-y-4">
                  {albumGroups
                    .filter((g: any) => g.matchType === "exact")
                    .map((group: any) => (
                      <Card key={`exact-${group.artistId}-${group.normalizedName}`}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <CardTitle className="text-base">
                                  {group.albums[0].name} by {group.artistName}
                                </CardTitle>
                                <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                                  Exact
                                </span>
                              </div>
                              <CardDescription>
                                {group.totalTracks} total tracks across {group.albums.length}{" "}
                                entries
                              </CardDescription>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleMergeAlbums(group.albums, group.artistName)}
                            >
                              Merge These →
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {group.albums.map((album: any, index: number) => (
                              <div
                                key={album.id}
                                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="font-medium">
                                    {album.name}
                                    {album.year && ` (${album.year})`}
                                  </div>
                                  {index === 0 && (
                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                      Most Tracks
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {album.trackCount} tracks
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            )}

            {albumGroups.filter((g: any) => g.matchType === "fuzzy").length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-2">Similar Album Names (Fuzzy)</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  These albums have similar names and may be duplicates. Review carefully before
                  merging.
                </p>
                <div className="space-y-4">
                  {albumGroups
                    .filter((g: any) => g.matchType === "fuzzy")
                    .map((group: any) => (
                      <Card key={`fuzzy-${group.artistId}-${group.normalizedName}`}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <CardTitle className="text-base">
                                  {group.albums[0].name} by {group.artistName}
                                </CardTitle>
                                <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded">
                                  Fuzzy
                                </span>
                              </div>
                              <CardDescription>
                                {group.totalTracks} total tracks across {group.albums.length}{" "}
                                entries
                              </CardDescription>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleMergeAlbums(group.albums, group.artistName)}
                            >
                              Merge These →
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {group.albums.map((album: any, index: number) => (
                              <div
                                key={album.id}
                                className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="font-medium">
                                    {album.name}
                                    {album.year && ` (${album.year})`}
                                  </div>
                                  {index === 0 && (
                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                      Most Tracks
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {album.trackCount} tracks
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </section>
            )}
          </>
        )}

        {artistGroups.length === 0 && albumGroups.length === 0 && (
          <div className="text-center py-12">
            <Icon name="check-circled" className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No duplicates found</h3>
            <p className="text-sm text-muted-foreground">
              Your library is clean! All artists and albums have unique names.
            </p>
          </div>
        )}
      </div>

      {mergeType === "artist" ? (
        <ArtistMergeDialog
          sourceArtist={mergeData.source as ArtistOption | undefined}
          targetArtist={mergeData.target as ArtistOption | undefined}
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          onMerged={() => window.location.reload()}
        />
      ) : (
        <AlbumMergeDialog
          sourceAlbum={mergeData.source as AlbumOption | undefined}
          targetAlbum={mergeData.target as AlbumOption | undefined}
          artistName={mergeData.artistName}
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          onMerged={() => window.location.reload()}
        />
      )}
    </div>
  );
}

function CuratorDuplicatesForbidden() {
  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Curators only</h1>
      <p className="mt-2 text-muted-foreground">
        You need the curator or admin role to view duplicate detection.
      </p>
    </div>
  );
}

function DuplicatesLookupError() {
  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Could not load duplicates</h1>
      <p className="mt-2 text-muted-foreground">
        Duplicate detection failed. Try again in a moment.
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <GeneralErrorBoundary
      statusHandlers={{
        403: CuratorDuplicatesForbidden,
        500: DuplicatesLookupError,
      }}
    />
  );
}

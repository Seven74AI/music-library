import { type Prisma } from "#prisma/client.js";
import { data, Link, redirect } from "react-router";
import { useState } from "react";
import { AlbumEditDialog } from "#app/components/album-edit-dialog.tsx";
import { CuratorNotes } from "#app/components/curator-notes.tsx";
import { FlagForReviewDialog } from "#app/components/flag-for-review-dialog.tsx";
import { Breadcrumbs, type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/features/queue/library-tracks-page-size.ts";
import {
  mergedEntityNotFoundResponse,
  MergedEntityResolutionError,
  resolveCanonicalIdFromStartId,
} from "#app/utils/canonical-merged-entity.server.ts";
import { getStaleAuthSessionDestroyCookie, getUserIdOrNull } from "#app/utils/auth.server.ts";
import { getAlbumTitle } from "#app/utils/breadcrumb-utils.ts";
import { coverImageUrl, entityHeaderCoverPixelSize } from "#app/utils/cover-image-url.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  loadLibraryStatusByTrackId,
  loadUserPlaylists,
} from "#app/utils/track-list-loader.server.ts";
import { useOptionalUser, userHasPermission, userIsCuratorOrAdmin } from "#app/utils/user.ts";
import { type Route } from "./+types/albums.$albumId.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getAlbumTitle(loaderData),
};

async function resolvePublicAlbumId(startId: string): Promise<string> {
  try {
    return await resolveCanonicalIdFromStartId(startId, (id) =>
      prisma.album.findUnique({
        where: { id },
        select: { id: true, mergedIntoId: true },
      }),
    );
  } catch (error) {
    if (error instanceof MergedEntityResolutionError) {
      throw mergedEntityNotFoundResponse("Album");
    }
    throw error;
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await getUserIdOrNull(request);
  const staleCookie = await getStaleAuthSessionDestroyCookie(request, userId);
  const loaderHeaders = staleCookie ? { headers: { "set-cookie": staleCookie } } : undefined;
  const canonicalId = await resolvePublicAlbumId(params.albumId);
  if (canonicalId !== params.albumId) {
    throw redirect(`/albums/${canonicalId}`);
  }

  const albumMeta = await prisma.album.findUnique({
    where: { id: canonicalId },
    select: {
      id: true,
      name: true,
      year: true,
      coverImageId: true,
      createdAt: true,
      artist: {
        select: { id: true, name: true },
      },
      coverImage: { select: { objectKey: true } },
    },
  });

  if (!albumMeta) {
    throw new Response("Album not found", { status: 404 });
  }

  const albumTrackSelect = {
    id: true,
    title: true,
    duration: true,
    createdAt: true,
    serviceUrl: true,
    artist: {
      select: { id: true, name: true },
    },
    coverImage: { select: { objectKey: true } },
    service: {
      select: {
        displayName: true,
        logoUrl: true,
      },
    },
    audioFiles: {
      select: { id: true, format: true, objectKey: true },
    },
  } as const;

  const albumTracks: Array<Prisma.TrackGetPayload<{ select: typeof albumTrackSelect }>> = [];
  let trackCursor: string | undefined;
  while (true) {
    const page = await prisma.track.findMany({
      where: { albumId: canonicalId },
      select: albumTrackSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIBRARY_TRACKS_PAGE_SIZE,
      ...(trackCursor ? { skip: 1, cursor: { id: trackCursor } } : {}),
    });
    albumTracks.push(...page);
    if (page.length < LIBRARY_TRACKS_PAGE_SIZE) {
      break;
    }
    trackCursor = page[page.length - 1]?.id;
  }

  const album = { ...albumMeta, tracks: albumTracks };

  const trackIds = album.tracks.map((track) => track.id);
  const [{ libraryTrackIds, userTrackCreatedAtByTrackId }, playlists] = await Promise.all([
    loadLibraryStatusByTrackId(userId, trackIds),
    loadUserPlaylists(userId),
  ]);

  const tracks = album.tracks.map((track) => ({
    ...track,
    isInUserLibrary: libraryTrackIds.has(track.id),
    userTrackCreatedAt:
      userTrackCreatedAtByTrackId.get(track.id)?.toISOString() ?? track.createdAt.toISOString(),
  }));

  return data(
    {
      album: {
        ...album,
        tracks,
      },
      playlists,
    },
    loaderHeaders,
  );
}

export default function AlbumRoute({ loaderData }: Route.ComponentProps) {
  const { album, playlists } = loaderData;
  const user = useOptionalUser();
  const canEdit = userHasPermission(user, "update:album:any");
  const canFlagForReview = userIsCuratorOrAdmin(user);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const headerCoverUrl =
    coverImageUrl(album.coverImage?.objectKey, entityHeaderCoverPixelSize) || null;

  return (
    <OfflineRouteBlocker>
      <div className="py-8">
        <Breadcrumbs />

        <MusicEntityHeader
          label="Album"
          title={album.name}
          imageUrl={headerCoverUrl}
          fallbackIcon="camera"
          metadata={
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link
                to={`/artists/${album.artist.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {album.artist.name}
              </Link>
              {album.year ? <span aria-hidden="true">·</span> : null}
              {album.year ? <span>{album.year}</span> : null}
              <span aria-hidden="true">·</span>
              <span>
                {album.tracks.length} track{album.tracks.length !== 1 ? "s" : ""}
              </span>
              {(canEdit || canFlagForReview) && (
                <div className="ml-auto flex items-center gap-2">
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
                      <Icon name="pencil-1" className="mr-2 h-4 w-4" />
                      Edit Album
                    </Button>
                  )}
                  {canFlagForReview && (
                    <Button variant="outline" size="sm" onClick={() => setFlagDialogOpen(true)}>
                      <Icon name="file-text" className="mr-2 h-4 w-4" />
                      Flag for review
                    </Button>
                  )}
                </div>
              )}
            </div>
          }
        />

        {album.tracks.length > 0 ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Tracks ({album.tracks.length})</h2>
            <div role="list" aria-label={`Tracks from ${album.name}`}>
              {album.tracks.map((track, index) => (
                <TrackListItem
                  key={track.id}
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration,
                    coverImage: track.coverImage,
                    serviceUrl: track.serviceUrl,
                    service: track.service,
                    audioFiles: track.audioFiles,
                    isInUserLibrary: track.isInUserLibrary,
                  }}
                  userTrack={{ createdAt: track.userTrackCreatedAt }}
                  index={index}
                  playlists={playlists}
                  showQuickAddToPlaylist
                  showAddToLibrary
                  showAudioFileDownload={track.isInUserLibrary}
                  playlistContext={{ type: "album", albumId: album.id }}
                  showDuration
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Icon name="camera" className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No tracks in this album yet.</p>
          </div>
        )}

        {canFlagForReview && user ? (
          <section className="mt-10">
            <h2 className="mb-4 text-xl font-semibold">Curator notes</h2>
            <CuratorNotes entityType="album" entityId={album.id} currentUserId={user.id} />
          </section>
        ) : null}

        {canEdit && (
          <AlbumEditDialog
            album={{
              ...album,
              artistId: album.artist.id,
              coverImageId: album.coverImageId,
            }}
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            onSaved={() => window.location.reload()}
            currentUserId={user?.id}
          />
        )}
        {canFlagForReview && (
          <FlagForReviewDialog
            entityType="album"
            entityId={album.id}
            entityName={album.name}
            open={flagDialogOpen}
            onOpenChange={setFlagDialogOpen}
          />
        )}
      </div>
    </OfflineRouteBlocker>
  );
}

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { data, Link, useFetcher } from "react-router";
import { AddToPlaylistMenu } from "#app/components/add-to-playlist-menu.tsx";
import { useAudioPlayer } from "#app/components/audio-player-provider.tsx";
import { type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { CuratorNotes } from "#app/components/curator-notes.tsx";
import { FlagForReviewDialog } from "#app/components/flag-for-review-dialog.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";
import { AddToRoomQueueAction } from "#app/components/party-room/add-to-room-queue-action.tsx";
import { ReportIssueDialog } from "#app/components/report-issue-dialog.tsx";
import { TrackDetailsDialog } from "#app/components/track-details-dialog.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { getTrackTitle } from "#app/utils/breadcrumb-utils.ts";
import { prisma } from "#app/utils/db.server.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { isPlayableTrack } from "#app/utils/playable-track.ts";
import { loadUserPlaylists } from "#app/utils/track-list-loader.server.ts";
import { useTrackAudioFileDownload } from "#app/hooks/use-track-audio-file-download.ts";
import { useOptionalUser, userIsCuratorOrAdmin } from "#app/utils/user.ts";
import { type Route } from "./+types/library.$trackId.ts";

const RELATED_TRACK_LIMIT = 8;

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getTrackTitle(loaderData),
};

/** Play on this page is this track only. Album and artist rows continue their own lists. */
export function playbackContextForTrack(trackId: string) {
  return { type: "track" as const, trackId };
}

export function chooseRelatedTracks<T>(input: {
  album: { id: string; name: string } | null;
  artist: { id: string; name: string };
  albumTracks: T[];
  artistTracks: T[];
}): { source: "album" | "artist"; id: string; name: string; tracks: T[] } | null {
  if (input.album && input.albumTracks.length > 0) {
    return {
      source: "album",
      id: input.album.id,
      name: input.album.name,
      tracks: input.albumTracks,
    };
  }
  if (input.artistTracks.length > 0) {
    return {
      source: "artist",
      id: input.artist.id,
      name: input.artist.name,
      tracks: input.artistTracks,
    };
  }
  return null;
}

export function orderedGenreNames(
  genres: ReadonlyArray<{ name: string }> | null | undefined,
  primary: string | null | undefined,
) {
  const names = (genres ?? []).map((genre) => genre.name).filter((name) => name.length > 0);
  if (!primary) return names;

  const index = names.indexOf(primary);
  if (index > 0) {
    const [match] = names.splice(index, 1);
    if (match) names.unshift(match);
  } else if (index === -1) {
    names.unshift(primary);
  }
  return names;
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatAudioDetails(file: {
  format?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  fileSize?: number | null;
}) {
  const parts: string[] = [];
  if (file.format) parts.push(file.format.toUpperCase());
  if (file.bitrate) parts.push(`${file.bitrate} kbps`);
  if (file.sampleRate) parts.push(`${(file.sampleRate / 1000).toFixed(1)} kHz`);
  if (file.fileSize) parts.push(formatFileSize(file.fileSize));
  return parts.join(" · ") || "Audio file";
}

function formatTrackDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTrackPosition(
  trackNumber: number | null | undefined,
  totalTracks: number | null | undefined,
) {
  if (trackNumber == null) return null;
  if (totalTracks != null && totalTracks > 0) return `${trackNumber} of ${totalTracks}`;
  return String(trackNumber);
}

type RelatedTrackRow = {
  id: string;
  title: string;
  duration: number | null;
  createdAt: Date;
  serviceUrl: string | null;
  artist: { id: string; name: string };
  coverImage: { objectKey: string } | null;
  albumRecord: { id: string; name: string } | null;
  service: { displayName: string; logoUrl: string | null } | null;
  audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
  userTracks: Array<{ createdAt: Date }>;
};

function relatedTrackSelect(userId: string) {
  return {
    id: true,
    title: true,
    duration: true,
    createdAt: true,
    serviceUrl: true,
    artist: { select: { id: true, name: true } },
    albumRecord: { select: { id: true, name: true } },
    coverImage: { select: { objectKey: true } },
    service: { select: { displayName: true, logoUrl: true } },
    audioFiles: { select: { id: true, format: true, objectKey: true } },
    userTracks: {
      where: { userId, isActive: true },
      select: { createdAt: true },
      take: 1,
    },
  };
}

function withoutLibraryMembership(row: RelatedTrackRow) {
  const { userTracks, ...track } = row;
  return {
    ...track,
    isInUserLibrary: userTracks.length > 0,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const trackRaw = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: {
      id: true,
      title: true,
      artistId: true,
      artist: { select: { id: true, name: true } },
      albumId: true,
      albumRecord: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
      duration: true,
      genre: true,
      genres: { select: { id: true, name: true } },
      year: true,
      trackNumber: true,
      totalTracks: true,
      albumArtist: true,
      bpm: true,
      label: true,
      isrc: true,
      releaseDate: true,
      lyrics: true,
      serviceUrl: true,
      service: { select: { displayName: true } },
      coverImage: { select: { objectKey: true } },
      audioFiles: {
        select: {
          id: true,
          format: true,
          objectKey: true,
          fileSize: true,
          bitrate: true,
          sampleRate: true,
        },
      },
      userTracks: {
        where: { userId, isActive: true },
        select: { id: true },
        take: 1,
      },
      servicePlaylistTracks: {
        where: {
          isDeleted: false,
          deletedAt: null,
          playlist: { ownerId: userId, isActive: true },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!trackRaw) {
    throw new Response("Track not found", { status: 404 });
  }

  const relatedSelect = relatedTrackSelect(userId);
  const noRelatedTracks: RelatedTrackRow[] = [];
  const [playlists, containingPlaylists, albumTracks, artistTracks] = await Promise.all([
    loadUserPlaylists(userId),
    prisma.userPlaylist.findMany({
      where: {
        ownerId: userId,
        tracks: { some: { trackId: trackRaw.id } },
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    trackRaw.albumId
      ? prisma.track.findMany({
          where: { albumId: trackRaw.albumId, id: { not: trackRaw.id } },
          orderBy: [{ trackNumber: "asc" }, { title: "asc" }],
          take: RELATED_TRACK_LIMIT,
          select: relatedSelect,
        })
      : noRelatedTracks,
    prisma.track.findMany({
      where: { artistId: trackRaw.artistId, id: { not: trackRaw.id } },
      orderBy: { title: "asc" },
      take: RELATED_TRACK_LIMIT,
      select: relatedSelect,
    }),
  ]);

  const { userTracks, servicePlaylistTracks, ...track } = trackRaw;

  return data({
    track,
    isInUserLibrary: userTracks.length > 0,
    canDownload:
      userTracks.length > 0 || containingPlaylists.length > 0 || servicePlaylistTracks.length > 0,
    playlists,
    containingPlaylists,
    related: chooseRelatedTracks({
      album: track.albumRecord,
      artist: track.artist,
      albumTracks: albumTracks.map(withoutLibraryMembership),
      artistTracks: artistTracks.map(withoutLibraryMembership),
    }),
  });
}

function MetaLine({ items }: { items: Array<{ key: string; node: ReactNode } | null> }) {
  const present = items.filter((item): item is { key: string; node: ReactNode } => item !== null);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {present.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {item.node}
        </Fragment>
      ))}
    </div>
  );
}

export default function TrackRoute({ loaderData }: Route.ComponentProps) {
  const { track } = loaderData;
  const isInUserLibrary = loaderData.isInUserLibrary ?? false;
  const playlists = loaderData.playlists ?? [];
  const containingPlaylists = loaderData.containingPlaylists ?? [];
  const canDownload = loaderData.canDownload ?? (isInUserLibrary || containingPlaylists.length > 0);
  const related = loaderData.related ?? null;
  const user = useOptionalUser();
  const canCurate = userIsCuratorOrAdmin(user);
  const { playTrack, playNextTrack, addToUpNext, addToQueue, isLoadingNext } = useAudioPlayer();
  const {
    isDownloading,
    downloadAudioFile,
    label: downloadLabel,
  } = useTrackAudioFileDownload({
    id: track.id,
    title: track.title,
  });
  const libraryFetcher = useFetcher();
  const [inLibrary, setInLibrary] = useState(isInUserLibrary);
  const [editOpen, setEditOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    setInLibrary(isInUserLibrary);
  }, [isInUserLibrary, track.id]);

  useEffect(() => {
    const result = libraryFetcher.data;
    if (!result || typeof result !== "object" || !("status" in result)) return;
    if (result.status === "error") setInLibrary(isInUserLibrary);
  }, [libraryFetcher.data, isInUserLibrary]);

  const artist = track.artist ?? { id: "", name: "" };
  const album = track.albumRecord ?? null;
  const audioFiles = track.audioFiles ?? [];
  const hasAudio = isPlayableTrack({ audioFiles });
  const genreNames = orderedGenreNames(track.genres, track.genre);
  const bestAudio = selectBestAudioFile(audioFiles);
  const coverImageUrl = track.coverImage?.objectKey
    ? `/resources/images/${track.coverImage.objectKey}`
    : null;
  const lyrics = track.lyrics?.trim() ? track.lyrics.trim() : null;
  const libraryPending = libraryFetcher.state !== "idle";

  const playable = {
    id: track.id,
    title: track.title,
    artist: { id: artist.id, name: artist.name },
    duration: track.duration ?? null,
    coverImage: track.coverImage?.objectKey ? { objectKey: track.coverImage.objectKey } : null,
    audioFiles: audioFiles.map((file) => ({
      id: file.id,
      format: file.format ?? null,
      objectKey: file.objectKey,
    })),
  };

  const handlePlay = () => {
    if (!hasAudio) return;
    void playTrack(playable, playbackContextForTrack(track.id));
  };

  const queueAndToast = (action: (trackToQueue: typeof playable) => void, description: string) => {
    if (!hasAudio) return;
    action(playable);
    toast({ title: "Success", description, variant: "success" });
  };

  const addToLibrary = () => {
    if (libraryPending || inLibrary) return;
    setInLibrary(true);
    void libraryFetcher.submit(
      { trackId: track.id, action: "add" },
      { method: "post", action: "/resources/track-library" },
    );
  };

  const facts = [
    { label: "Track", value: formatTrackPosition(track.trackNumber, track.totalTracks) },
    {
      label: "Album artist",
      value: track.albumArtist && track.albumArtist !== artist.name ? track.albumArtist : null,
    },
    { label: "BPM", value: track.bpm ? String(track.bpm) : null },
    { label: "Label", value: track.label },
    { label: "ISRC", value: track.isrc },
    { label: "Released", value: formatTrackDate(track.releaseDate) },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  const sourceLabel = track.service?.displayName
    ? `Open on ${track.service.displayName}`
    : "Open source";
  const showMore = hasAudio || Boolean(track.serviceUrl) || Boolean(user);
  const relatedHref = related
    ? related.source === "album"
      ? `/albums/${related.id}`
      : `/artists/${related.id}`
    : null;
  const relatedContext = related
    ? related.source === "album"
      ? { type: "album" as const, albumId: related.id }
      : { type: "artist" as const, artistId: related.id }
    : null;

  return (
    <OfflineRouteBlocker>
      <div className="py-8">
        <MusicEntityHeader
          label="Track"
          title={track.title}
          imageUrl={coverImageUrl}
          fallbackIcon="file-text"
          metadata={
            <div className="flex flex-col gap-4">
              <MetaLine
                items={[
                  artist.name
                    ? {
                        key: "artist",
                        node: (
                          <Link
                            to={`/artists/${artist.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {artist.name}
                          </Link>
                        ),
                      }
                    : null,
                  album
                    ? {
                        key: "album",
                        node: (
                          <Link
                            to={`/albums/${album.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {album.name}
                          </Link>
                        ),
                      }
                    : null,
                  {
                    key: "duration",
                    node: (
                      <span>
                        {track.duration != null
                          ? formatDuration(track.duration)
                          : "Unknown duration"}
                      </span>
                    ),
                  },
                  track.year ? { key: "year", node: <span>{track.year}</span> } : null,
                  genreNames.length > 0
                    ? { key: "genres", node: <span>{genreNames.join(", ")}</span> }
                    : null,
                  bestAudio?.format
                    ? { key: "format", node: <span>{bestAudio.format.toUpperCase()}</span> }
                    : null,
                ]}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={handlePlay} disabled={!hasAudio || isLoadingNext}>
                  <Icon
                    name={isLoadingNext ? "update" : "play"}
                    className={`mr-2 h-4 w-4 ${isLoadingNext ? "animate-spin" : ""}`}
                  />
                  {isLoadingNext ? "Preparing..." : "Play"}
                </Button>
                {hasAudio && canDownload ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void downloadAudioFile()}
                    disabled={isDownloading}
                  >
                    <Icon
                      name={isDownloading ? "update" : "download"}
                      className={`mr-2 h-4 w-4 ${isDownloading ? "animate-spin" : ""}`}
                    />
                    {downloadLabel}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline">
                      <Icon name="plus" className="mr-2 h-4 w-4" />
                      Add to playlist
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <AddToPlaylistMenu
                      trackId={track.id}
                      trackTitle={track.title}
                      playlists={playlists}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
                {inLibrary ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addToLibrary}
                    disabled={libraryPending}
                  >
                    <Icon name="plus" className="mr-2 h-4 w-4" />
                    {libraryPending ? "Adding..." : "Add to library"}
                  </Button>
                )}
                {showMore ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" aria-label="More actions">
                        <Icon name="dots-horizontal" className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {hasAudio ? (
                        <>
                          <DropdownMenuItem
                            onClick={() =>
                              queueAndToast(playNextTrack, `"${track.title}" will play next`)
                            }
                          >
                            <Icon name="arrow-right" className="mr-2 h-4 w-4" />
                            Play next
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              queueAndToast(addToUpNext, `"${track.title}" added to up next`)
                            }
                          >
                            <Icon name="list-bullet" className="mr-2 h-4 w-4" />
                            Add to up next
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              queueAndToast(addToQueue, `"${track.title}" added to queue`)
                            }
                          >
                            <Icon name="plus" className="mr-2 h-4 w-4" />
                            Add to queue
                          </DropdownMenuItem>
                          <AddToRoomQueueAction trackId={track.id} variant="dropdown" />
                        </>
                      ) : null}
                      {track.serviceUrl ? (
                        <DropdownMenuItem asChild>
                          <a href={track.serviceUrl} target="_blank" rel="noopener noreferrer">
                            <Icon name="link-2" className="mr-2 h-4 w-4" />
                            {sourceLabel}
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                      {user ? (
                        <DropdownMenuItem
                          onClick={() => {
                            window.setTimeout(() => setReportOpen(true), 0);
                          }}
                        >
                          <Icon name="question-mark-circled" className="mr-2 h-4 w-4" />
                          Report issue
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {canCurate ? (
                  <>
                    <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                      <Icon name="pencil-1" className="mr-2 h-4 w-4" />
                      Edit track
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setFlagOpen(true)}>
                      <Icon name="file-text" className="mr-2 h-4 w-4" />
                      Flag for review
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          }
        />

        <div className="flex flex-col gap-10">
          {hasAudio ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Audio</h2>
              <ul className="divide-y rounded-lg border">
                {audioFiles.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <span>{formatAudioDetails(file)}</span>
                    {audioFiles.length > 1 && file.id === bestAudio?.id ? (
                      <span className="text-xs text-muted-foreground">Playback</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              Audio is not available for this track yet.
            </p>
          )}

          {facts.length > 0 ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Details</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-sm font-medium text-muted-foreground">{fact.label}</dt>
                    <dd className="text-base">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {lyrics ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Lyrics</h2>
              <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                {lyrics}
              </p>
            </section>
          ) : null}

          {containingPlaylists.length > 0 ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold">In your playlists</h2>
              <ul className="flex flex-col gap-2">
                {containingPlaylists.map((playlist) => (
                  <li key={playlist.id}>
                    <Link to={`/playlists/${playlist.id}`} className="font-medium hover:underline">
                      {playlist.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {related && related.tracks.length > 0 && relatedHref && relatedContext ? (
            <section>
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold">More from {related.name || "this artist"}</h2>
                <Link to={relatedHref} className="shrink-0 text-sm font-medium hover:underline">
                  See all
                </Link>
              </div>
              <div role="grid" aria-label={`More from ${related.name}`}>
                {related.tracks.map((relatedTrack, index) => (
                  <TrackListItem
                    key={relatedTrack.id}
                    track={{
                      ...relatedTrack,
                      album:
                        related.source === "artist" && relatedTrack.albumRecord
                          ? relatedTrack.albumRecord
                          : null,
                    }}
                    userTrack={{ createdAt: relatedTrack.createdAt }}
                    index={index}
                    playlists={playlists}
                    showQuickAddToPlaylist
                    showAddToLibrary
                    showAudioFileDownload={relatedTrack.isInUserLibrary}
                    playlistContext={relatedContext}
                    showDuration
                    isCurator={canCurate}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {canCurate && user ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Curator notes</h2>
              <CuratorNotes entityType="track" entityId={track.id} currentUserId={user.id} />
            </section>
          ) : null}
        </div>

        {reportOpen ? (
          <ReportIssueDialog
            trackId={track.id}
            trackTitle={track.title}
            open={reportOpen}
            onOpenChange={setReportOpen}
          />
        ) : null}
        {canCurate ? (
          <>
            <TrackDetailsDialog trackId={track.id} open={editOpen} onOpenChange={setEditOpen} />
            <FlagForReviewDialog
              entityType="track"
              entityId={track.id}
              entityName={track.title}
              open={flagOpen}
              onOpenChange={setFlagOpen}
            />
          </>
        ) : null}
      </div>
    </OfflineRouteBlocker>
  );
}

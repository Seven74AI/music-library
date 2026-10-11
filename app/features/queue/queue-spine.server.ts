import { listLibraryQueueSpineTracks } from "#app/features/listening-insights/library-tracks.server.ts";
import { listDiscoverSpineTracks } from "#app/utils/discover-tracks.server.ts";
import {
  defaultDiscoverSortDirection,
  parseDiscoverSort,
  type DiscoverSortOption,
} from "#app/utils/discover.ts";
import {
  DEFAULT_LIBRARY_SORT,
  defaultLibrarySortDirection,
  parseLibrarySort,
  type LibrarySortOption,
} from "#app/features/listening-insights/heavy-rotation.ts";
import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  defaultPlaylistTrackSortDirection,
  parsePlaylistTrackSort,
  sortPlaylistTracks,
  type PlaylistTrackSortOption,
} from "#app/utils/playlist-track-sort.ts";
import { parseSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";

export const QUEUE_TRACK_SELECT = {
  id: true,
  title: true,
  artist: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

type LibrarySpineParams = {
  context: "library";
  hasAudioOnly: true;
  sort: LibrarySortOption;
  direction: SortDirection;
};

type PlaylistSpineParams = {
  context: "playlist";
  playlistId: string;
  sort: PlaylistTrackSortOption;
  direction: SortDirection;
};

type ArtistSpineParams = {
  context: "artist";
  artistId: string;
};

type AlbumSpineParams = {
  context: "album";
  albumId: string;
};

type TrackSpineParams = {
  context: "track";
  trackId: string;
};

type OnRepeatSnapshotSpineParams = {
  context: "onRepeatSnapshot";
  snapshotId: string;
};

type DiscoverSpineParams = {
  context: "discover";
  sort: DiscoverSortOption;
  direction: SortDirection;
};

export type QueueSpineParams =
  | LibrarySpineParams
  | PlaylistSpineParams
  | ArtistSpineParams
  | AlbumSpineParams
  | TrackSpineParams
  | OnRepeatSnapshotSpineParams
  | DiscoverSpineParams;

type ParseResult = { ok: true; value: QueueSpineParams } | { ok: false; error: string };

export function parseQueueSpineParams(searchParams: URLSearchParams): ParseResult {
  const context = searchParams.get("context");

  if (context === "library") {
    if (searchParams.get("hasAudio") !== "1") {
      return { ok: false, error: "Invalid hasAudio parameter" };
    }

    const sort = parseLibrarySort(searchParams.get("sort") ?? DEFAULT_LIBRARY_SORT);
    return {
      ok: true,
      value: {
        context: "library",
        hasAudioOnly: true,
        sort,
        direction: parseSortDirection(searchParams.get("dir"), defaultLibrarySortDirection(sort)),
      },
    };
  }

  if (context === "playlist") {
    const playlistId = searchParams.get("playlistId");
    if (!playlistId) {
      return { ok: false, error: "Playlist ID is required" };
    }

    const sort = parsePlaylistTrackSort(searchParams.get("sort"));
    return {
      ok: true,
      value: {
        context: "playlist",
        playlistId,
        sort,
        direction: parseSortDirection(
          searchParams.get("dir"),
          defaultPlaylistTrackSortDirection(sort),
        ),
      },
    };
  }

  if (context === "artist") {
    const artistId = searchParams.get("artistId");
    if (!artistId) {
      return { ok: false, error: "Artist ID is required" };
    }

    return {
      ok: true,
      value: { context: "artist", artistId },
    };
  }

  if (context === "album") {
    const albumId = searchParams.get("albumId");
    if (!albumId) {
      return { ok: false, error: "Album ID is required" };
    }

    return {
      ok: true,
      value: { context: "album", albumId },
    };
  }

  if (context === "track") {
    const trackId = searchParams.get("trackId");
    if (!trackId) {
      return { ok: false, error: "Track ID is required" };
    }

    return {
      ok: true,
      value: { context: "track", trackId },
    };
  }

  if (context === "discover") {
    const sort = parseDiscoverSort(searchParams.get("sort"));
    return {
      ok: true,
      value: {
        context: "discover",
        sort,
        direction: parseSortDirection(searchParams.get("dir"), defaultDiscoverSortDirection(sort)),
      },
    };
  }

  if (context === "onRepeatSnapshot") {
    const snapshotId = searchParams.get("snapshotId");
    if (!snapshotId) {
      return { ok: false, error: "Snapshot ID is required" };
    }

    return {
      ok: true,
      value: { context: "onRepeatSnapshot", snapshotId },
    };
  }

  return { ok: false, error: "Invalid context parameter" };
}

export async function fetchQueueSpine(
  userId: string,
  params: QueueSpineParams,
): Promise<{ tracks: QueueTrack[]; total: number }> {
  if (params.context === "library") {
    const tracks = await listLibraryQueueSpineTracks({
      userId,
      sort: params.sort,
      direction: params.direction,
      hasAudioOnly: params.hasAudioOnly,
    });
    return { tracks, total: tracks.length };
  }

  if (params.context === "playlist") {
    const playlistTracks = await prisma.userPlaylistTrack.findMany({
      where: {
        playlistId: params.playlistId,
        playlist: { ownerId: userId },
      },
      select: {
        position: true,
        createdAt: true,
        track: {
          select: {
            ...QUEUE_TRACK_SELECT,
            duration: true,
          },
        },
      },
      orderBy: { position: "asc" },
    });

    const sorted = sortPlaylistTracks(playlistTracks, params.sort, params.direction);
    const tracks = sorted.map((playlistTrack) => ({
      id: playlistTrack.track.id,
      title: playlistTrack.track.title,
      artist: playlistTrack.track.artist,
    }));
    return { tracks, total: tracks.length };
  }

  if (params.context === "artist") {
    const tracks = await prisma.track.findMany({
      where: { artistId: params.artistId },
      select: QUEUE_TRACK_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return { tracks, total: tracks.length };
  }

  if (params.context === "album") {
    const tracks = await prisma.track.findMany({
      where: { albumId: params.albumId },
      select: QUEUE_TRACK_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return { tracks, total: tracks.length };
  }

  if (params.context === "discover") {
    const tracks = await listDiscoverSpineTracks({
      sort: params.sort,
      direction: params.direction,
    });
    return { tracks, total: tracks.length };
  }

  if (params.context === "onRepeatSnapshot") {
    const snapshotTracks = await prisma.onRepeatSnapshotTrack.findMany({
      where: {
        snapshotId: params.snapshotId,
        snapshot: { userId },
      },
      select: {
        track: {
          select: QUEUE_TRACK_SELECT,
        },
      },
      orderBy: { position: "asc" },
    });

    const tracks = snapshotTracks.map((row) => row.track);
    return { tracks, total: tracks.length };
  }

  const track = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: QUEUE_TRACK_SELECT,
  });
  const tracks = track ? [track] : [];
  return { tracks, total: tracks.length };
}

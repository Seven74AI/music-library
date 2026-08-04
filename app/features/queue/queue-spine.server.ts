import { type QueueTrack } from "#app/types/frontend/shared.ts";
import { prisma } from "#app/utils/db.server.ts";
import { buildLibraryUserTracksWhere } from "#app/utils/library-user-tracks.server.ts";

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
};

type PlaylistSpineParams = {
  context: "playlist";
  playlistId: string;
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

export type QueueSpineParams =
  | LibrarySpineParams
  | PlaylistSpineParams
  | ArtistSpineParams
  | AlbumSpineParams
  | TrackSpineParams;

type ParseResult = { ok: true; value: QueueSpineParams } | { ok: false; error: string };

export function parseQueueSpineParams(searchParams: URLSearchParams): ParseResult {
  const context = searchParams.get("context");

  if (context === "library") {
    if (searchParams.get("hasAudio") !== "1") {
      return { ok: false, error: "Invalid hasAudio parameter" };
    }

    return {
      ok: true,
      value: { context: "library", hasAudioOnly: true },
    };
  }

  if (context === "playlist") {
    const playlistId = searchParams.get("playlistId");
    if (!playlistId) {
      return { ok: false, error: "Playlist ID is required" };
    }

    return {
      ok: true,
      value: { context: "playlist", playlistId },
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

  return { ok: false, error: "Invalid context parameter" };
}

export async function fetchQueueSpine(
  userId: string,
  params: QueueSpineParams,
): Promise<{ tracks: QueueTrack[]; total: number }> {
  if (params.context === "library") {
    const userTracks = await prisma.userTrack.findMany({
      where: buildLibraryUserTracksWhere({
        userId,
        hasAudioOnly: params.hasAudioOnly,
      }),
      select: {
        track: {
          select: QUEUE_TRACK_SELECT,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const tracks = userTracks.map((userTrack) => userTrack.track);
    return { tracks, total: tracks.length };
  }

  if (params.context === "playlist") {
    const playlistTracks = await prisma.userPlaylistTrack.findMany({
      where: {
        playlistId: params.playlistId,
        playlist: { ownerId: userId },
      },
      select: {
        track: {
          select: QUEUE_TRACK_SELECT,
        },
      },
      orderBy: { position: "asc" },
    });

    const tracks = playlistTracks.map((playlistTrack) => playlistTrack.track);
    return { tracks, total: tracks.length };
  }

  if (params.context === "artist") {
    const tracks = await prisma.track.findMany({
      where: { artistId: params.artistId },
      select: QUEUE_TRACK_SELECT,
      orderBy: { createdAt: "desc" },
      take: 50,
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

  const track = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: QUEUE_TRACK_SELECT,
  });
  const tracks = track ? [track] : [];
  return { tracks, total: tracks.length };
}

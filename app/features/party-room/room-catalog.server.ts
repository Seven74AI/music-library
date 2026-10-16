/**
 * Playable album and artist pages for the party-room guest shell.
 * Only tracks with an audio file are listed — the same catalog as room search.
 */

import { canAddTracks } from "#app/features/party-room/capabilities.ts";
import { parseRoomCodeInput } from "#app/features/party-room/codes.ts";
import { resolveRoomParticipantByCode } from "#app/features/party-room/participant-seat.server.ts";
import { type RoomCatalogTrack } from "#app/features/party-room/room-browse.ts";
import { prisma } from "#app/utils/db.server.ts";

export const ROOM_ARTIST_TRACK_LIMIT = 100;

const hasAudio = { audioFiles: { some: {} } } as const;

export type RoomAlbumPageData = {
  id: string;
  name: string;
  year: number | null;
  coverObjectKey: string | null;
  artist: { id: string; name: string };
  tracks: RoomCatalogTrack[];
};

export type RoomArtistAlbum = {
  id: string;
  name: string;
  year: number | null;
  coverObjectKey: string | null;
  trackCount: number;
};

export type RoomArtistPageData = {
  id: string;
  name: string;
  genre: string | null;
  imageObjectKey: string | null;
  albums: RoomArtistAlbum[];
  tracks: RoomCatalogTrack[];
  trackCount: number;
};

function compareAlbumTracks(
  a: { trackNumber: number | null; title: string },
  b: { trackNumber: number | null; title: string },
) {
  const aNum = a.trackNumber ?? Number.POSITIVE_INFINITY;
  const bNum = b.trackNumber ?? Number.POSITIVE_INFINITY;
  if (aNum !== bNum) return aNum - bNum;
  return a.title.localeCompare(b.title);
}

export async function requireRoomCatalogSeat(request: Request, rawCode: string) {
  const code = parseRoomCodeInput(rawCode) ?? rawCode.toUpperCase();
  const participant = await resolveRoomParticipantByCode(request, code);
  if (!participant) {
    throw new Response(null, { status: 302, headers: { Location: `/rooms/${code}` } });
  }
  return {
    code,
    participant,
    canAddTracks: canAddTracks(participant.role),
  };
}

export async function loadRoomAlbum(albumId: string): Promise<RoomAlbumPageData | null> {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: {
      id: true,
      name: true,
      year: true,
      coverImage: { select: { objectKey: true } },
      artist: { select: { id: true, name: true } },
      tracks: {
        where: hasAudio,
        select: {
          id: true,
          title: true,
          trackNumber: true,
          duration: true,
          artist: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!album) return null;

  const tracks = [...album.tracks].sort(compareAlbumTracks).map((track): RoomCatalogTrack => ({
    id: track.id,
    title: track.title,
    artistName: track.artist.name,
    artistId: track.artist.id,
    albumName: album.name,
    albumId: album.id,
    duration: track.duration,
    trackNumber: track.trackNumber,
  }));

  return {
    id: album.id,
    name: album.name,
    year: album.year,
    coverObjectKey: album.coverImage?.objectKey ?? null,
    artist: album.artist,
    tracks,
  };
}

export async function loadRoomArtist(artistId: string): Promise<RoomArtistPageData | null> {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      name: true,
      genre: true,
      imageUrl: true,
      albums: {
        where: { tracks: { some: hasAudio } },
        select: {
          id: true,
          name: true,
          year: true,
          coverImage: { select: { objectKey: true } },
          _count: { select: { tracks: { where: hasAudio } } },
        },
      },
      tracks: {
        where: hasAudio,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ROOM_ARTIST_TRACK_LIMIT,
        select: {
          id: true,
          title: true,
          duration: true,
          artist: { select: { id: true, name: true } },
          albumRecord: { select: { id: true, name: true } },
        },
      },
      _count: { select: { tracks: { where: hasAudio } } },
    },
  });
  if (!artist) return null;

  const albums = artist.albums
    .map((album) => ({
      id: album.id,
      name: album.name,
      year: album.year,
      coverObjectKey: album.coverImage?.objectKey ?? null,
      trackCount: album._count.tracks,
    }))
    .sort((a, b) => {
      const yearA = a.year ?? Number.POSITIVE_INFINITY;
      const yearB = b.year ?? Number.POSITIVE_INFINITY;
      if (yearA !== yearB) return yearA - yearB;
      return a.name.localeCompare(b.name);
    });

  return {
    id: artist.id,
    name: artist.name,
    genre: artist.genre,
    imageObjectKey: artist.imageUrl,
    albums,
    trackCount: artist._count.tracks,
    tracks: artist.tracks.map((track): RoomCatalogTrack => ({
      id: track.id,
      title: track.title,
      artistName: track.artist.name,
      artistId: track.artist.id,
      albumName: track.albumRecord?.name ?? null,
      albumId: track.albumRecord?.id ?? null,
      duration: track.duration,
    })),
  };
}

import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import * as coverManagement from "#app/utils/cover-management.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { COVER_ADMIN_CLIENT_ERROR_MESSAGE } from "#app/utils/error-handlers.server.ts";
import {
  countTracksWithoutCovers,
  getTracksWithoutCovers,
  retryFetchCover,
  uploadAlbumCover,
  uploadTrackCover,
} from "./cover-fetch.server.ts";

const createdTrackIds: string[] = [];
const createdAlbumIds: string[] = [];
const createdArtistIds: string[] = [];
const createdPlaylistIds: string[] = [];
const createdUserIds: string[] = [];
const createdCoverIds: string[] = [];

afterEach(async () => {
  if (createdPlaylistIds.length > 0) {
    await prisma.servicePlaylist.deleteMany({ where: { id: { in: createdPlaylistIds } } });
    createdPlaylistIds.length = 0;
  }
  if (createdTrackIds.length > 0) {
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdAlbumIds.length > 0) {
    await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
    createdAlbumIds.length = 0;
  }
  if (createdCoverIds.length > 0) {
    await prisma.coverImage.deleteMany({ where: { id: { in: createdCoverIds } } });
    createdCoverIds.length = 0;
  }
  if (createdArtistIds.length > 0) {
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

test("uploadTrackCover returns stable message when storage fails", async () => {
  consoleError.mockImplementation(() => {});
  const storageLeak = "Tigris PutObject failed: AccessDenied on images/tracks/x.jpg";
  const findOrCreateSpy = vi
    .spyOn(coverManagement, "findOrCreateCoverImage")
    .mockRejectedValueOnce(new Error(storageLeak));

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const artist = await prisma.artist.create({
    data: {
      name: `Cover fail ${suffix}`,
      normalizedName: `cover fail ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const track = await prisma.track.create({
    data: {
      title: `Cover fail track ${suffix}`,
      externalId: `cover-fail-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
    },
  });
  createdTrackIds.push(track.id);

  try {
    const result = await uploadTrackCover(track.id, Buffer.from("fake-image"));
    expect(result.success).toBe(false);
    expect(result.error).toBe(COVER_ADMIN_CLIENT_ERROR_MESSAGE);
    expect(result.error).not.toMatch(/Tigris/i);
  } finally {
    findOrCreateSpy.mockRestore();
  }
});

test("lists coverless tracks and attaches a playlist thumbnail when one is present", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const owner = await prisma.user.create({
    data: {
      email: `covers-${suffix}@example.com`,
      username: `covers${suffix}`.slice(0, 20),
    },
  });
  createdUserIds.push(owner.id);
  const artist = await prisma.artist.create({
    data: {
      name: `Coverless Artist ${suffix}`,
      normalizedName: `coverless artist ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const playlist = await prisma.servicePlaylist.create({
    data: {
      serviceId: service.id,
      externalId: `pl-${suffix}`,
      title: `Playlist ${suffix}`,
      itemCount: 2,
      ownerId: owner.id,
    },
  });
  createdPlaylistIds.push(playlist.id);

  const noPlaylistTrack = await prisma.track.create({
    data: {
      title: `No playlist ${suffix}`,
      externalId: `no-pl-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
    },
  });
  const nullThumbnailTrack = await prisma.track.create({
    data: {
      title: `Null thumbnail ${suffix}`,
      externalId: `null-thumb-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      servicePlaylistTracks: {
        create: { playlistId: playlist.id, position: 0, thumbnailUrl: null },
      },
    },
  });
  const thumbnailUrl = `https://example.com/covers/${suffix}.jpg`;
  const thumbnailTrack = await prisma.track.create({
    data: {
      title: `Has thumbnail ${suffix}`,
      externalId: `thumb-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      servicePlaylistTracks: {
        create: { playlistId: playlist.id, position: 1, thumbnailUrl },
      },
    },
  });
  const cover = await prisma.coverImage.create({
    data: {
      contentHash: `hash-${suffix}`,
      objectKey: `covers/${suffix}.jpg`,
    },
  });
  createdCoverIds.push(cover.id);
  const coveredTrack = await prisma.track.create({
    data: {
      title: `Has cover ${suffix}`,
      externalId: `covered-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      coverImageId: cover.id,
    },
  });
  createdTrackIds.push(
    noPlaylistTrack.id,
    nullThumbnailTrack.id,
    thumbnailTrack.id,
    coveredTrack.id,
  );

  const coverlessCount = await prisma.track.count({ where: { coverImageId: null } });
  const listed = await getTracksWithoutCovers({ limit: coverlessCount });
  const listedById = new Map(listed.map((track) => [track.id, track]));

  expect(await countTracksWithoutCovers()).toBe(coverlessCount);
  expect(listed).toHaveLength(coverlessCount);
  expect(listedById.has(noPlaylistTrack.id)).toBe(true);
  expect(listedById.has(nullThumbnailTrack.id)).toBe(true);
  expect(listedById.has(coveredTrack.id)).toBe(false);
  expect(listedById.get(noPlaylistTrack.id)?.thumbnailUrl).toBeNull();
  expect(listedById.get(nullThumbnailTrack.id)?.thumbnailUrl).toBeNull();
  expect(listedById.get(thumbnailTrack.id)?.thumbnailUrl).toBe(thumbnailUrl);
});

test("track cover upload stores the chosen file when the album already has a cover", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const artist = await prisma.artist.create({
    data: {
      name: `Upload Artist ${suffix}`,
      normalizedName: `upload artist ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const albumCover = await prisma.coverImage.create({
    data: {
      contentHash: `album-cover-${suffix}`,
      objectKey: `covers/album-${suffix}.jpg`,
    },
  });
  createdCoverIds.push(albumCover.id);
  const album = await prisma.album.create({
    data: {
      name: `Already Covered ${suffix}`,
      artistId: artist.id,
      coverImageId: albumCover.id,
    },
  });
  createdAlbumIds.push(album.id);
  const track = await prisma.track.create({
    data: {
      title: `Upload target ${suffix}`,
      externalId: `upload-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      albumId: album.id,
    },
  });
  createdTrackIds.push(track.id);

  const image = await sharp({
    create: {
      width: 12,
      height: 10,
      channels: 3,
      background: { r: 19, g: 83, b: 141 },
    },
  })
    .jpeg()
    .toBuffer();
  const canonical = await sharp(image)
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const uploadedHash = createHash("sha256").update(canonical).digest("hex");

  const result = await uploadTrackCover(track.id, image);
  expect(result).toEqual({ success: true });

  const updated = await prisma.track.findUniqueOrThrow({
    where: { id: track.id },
    select: {
      coverImageId: true,
      coverImage: { select: { id: true, contentHash: true } },
    },
  });
  expect(updated.coverImage?.contentHash).toBe(uploadedHash);
  expect(updated.coverImageId).not.toBe(albumCover.id);
  if (updated.coverImageId) createdCoverIds.push(updated.coverImageId);

  const albumAfter = await prisma.album.findUniqueOrThrow({
    where: { id: album.id },
    select: { coverImageId: true },
  });
  expect(albumAfter.coverImageId).toBe(albumCover.id);
  expect(await prisma.track.count({ where: { id: track.id, coverImageId: null } })).toBe(0);
});

test("album cover upload stores the chosen file when the album already has a cover", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `Album Upload Artist ${suffix}`,
      normalizedName: `album upload artist ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const albumCover = await prisma.coverImage.create({
    data: {
      contentHash: `album-old-${suffix}`,
      objectKey: `covers/album-old-${suffix}.jpg`,
    },
  });
  createdCoverIds.push(albumCover.id);
  const album = await prisma.album.create({
    data: {
      name: `Replace Cover ${suffix}`,
      artistId: artist.id,
      coverImageId: albumCover.id,
    },
  });
  createdAlbumIds.push(album.id);

  const image = await sharp({
    create: {
      width: 12,
      height: 10,
      channels: 3,
      background: { r: 41, g: 121, b: 9 },
    },
  })
    .jpeg()
    .toBuffer();
  const canonical = await sharp(image)
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const uploadedHash = createHash("sha256").update(canonical).digest("hex");

  const result = await uploadAlbumCover(album.id, image);
  expect(result).toEqual({ success: true });

  const updated = await prisma.album.findUniqueOrThrow({
    where: { id: album.id },
    select: {
      coverImageId: true,
      coverImage: { select: { id: true, contentHash: true } },
    },
  });
  expect(updated.coverImage?.contentHash).toBe(uploadedHash);
  expect(updated.coverImageId).not.toBe(albumCover.id);
  if (updated.coverImageId) createdCoverIds.push(updated.coverImageId);
});

test("retryFetchCover does not overwrite a cover assigned during download", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const owner = await prisma.user.create({
    data: {
      email: `toctou-${suffix}@example.com`,
      username: `toctou${suffix}`.slice(0, 20),
    },
  });
  createdUserIds.push(owner.id);
  const artist = await prisma.artist.create({
    data: {
      name: `TOCTOU Artist ${suffix}`,
      normalizedName: `toctou artist ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const playlist = await prisma.servicePlaylist.create({
    data: {
      serviceId: service.id,
      externalId: `pl-toctou-${suffix}`,
      title: `Playlist ${suffix}`,
      itemCount: 1,
      ownerId: owner.id,
    },
  });
  createdPlaylistIds.push(playlist.id);
  const track = await prisma.track.create({
    data: {
      title: `TOCTOU track ${suffix}`,
      externalId: `toctou-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      servicePlaylistTracks: {
        create: {
          playlistId: playlist.id,
          position: 0,
          thumbnailUrl: `https://example.com/thumb-${suffix}.jpg`,
        },
      },
    },
  });
  createdTrackIds.push(track.id);
  const curatorCover = await prisma.coverImage.create({
    data: {
      contentHash: `curator-${suffix}`,
      objectKey: `covers/curator-${suffix}.jpg`,
    },
  });
  createdCoverIds.push(curatorCover.id);

  const youtubeBytes = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();

  const downloadSpy = vi
    .spyOn(coverManagement, "downloadExternalImage")
    .mockImplementation(async () => {
      await prisma.track.update({
        where: { id: track.id },
        data: { coverImageId: curatorCover.id },
      });
      return youtubeBytes;
    });

  try {
    const result = await retryFetchCover(track.id);
    expect(result).toEqual({ success: true });

    const updated = await prisma.track.findUniqueOrThrow({
      where: { id: track.id },
      select: { coverImageId: true },
    });
    expect(updated.coverImageId).toBe(curatorCover.id);
  } finally {
    downloadSpy.mockRestore();
  }
});

test("retryFetchCover does not overwrite an album cover assigned during download", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  const owner = await prisma.user.create({
    data: {
      email: `album-toctou-${suffix}@example.com`,
      username: `albtct${suffix}`.slice(0, 20),
    },
  });
  createdUserIds.push(owner.id);
  const artist = await prisma.artist.create({
    data: {
      name: `Album TOCTOU Artist ${suffix}`,
      normalizedName: `album toctou artist ${suffix}`,
    },
  });
  createdArtistIds.push(artist.id);
  const album = await prisma.album.create({
    data: {
      name: `Bare Album ${suffix}`,
      artistId: artist.id,
      coverImageId: null,
    },
  });
  createdAlbumIds.push(album.id);
  const playlist = await prisma.servicePlaylist.create({
    data: {
      serviceId: service.id,
      externalId: `pl-album-toctou-${suffix}`,
      title: `Playlist ${suffix}`,
      itemCount: 1,
      ownerId: owner.id,
    },
  });
  createdPlaylistIds.push(playlist.id);
  const track = await prisma.track.create({
    data: {
      title: `Album TOCTOU track ${suffix}`,
      externalId: `album-toctou-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      albumId: album.id,
      servicePlaylistTracks: {
        create: {
          playlistId: playlist.id,
          position: 0,
          thumbnailUrl: `https://example.com/thumb-${suffix}.jpg`,
        },
      },
    },
  });
  createdTrackIds.push(track.id);
  const curatorCover = await prisma.coverImage.create({
    data: {
      contentHash: `album-curator-${suffix}`,
      objectKey: `covers/album-curator-${suffix}.jpg`,
    },
  });
  createdCoverIds.push(curatorCover.id);

  const youtubeBytes = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 10, g: 200, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();

  const downloadSpy = vi
    .spyOn(coverManagement, "downloadExternalImage")
    .mockImplementation(async () => {
      await prisma.album.update({
        where: { id: album.id },
        data: { coverImageId: curatorCover.id },
      });
      return youtubeBytes;
    });

  try {
    const result = await retryFetchCover(track.id);
    expect(result).toEqual({ success: true });

    const albumAfter = await prisma.album.findUniqueOrThrow({
      where: { id: album.id },
      select: { coverImageId: true },
    });
    expect(albumAfter.coverImageId).toBe(curatorCover.id);
  } finally {
    downloadSpy.mockRestore();
  }
});

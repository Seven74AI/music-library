/**
 * Unit tests for search functionality
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  searchAlbums,
  searchAll,
  searchArtists,
  searchPlaylists,
  searchTracks,
} from "#app/utils/search.server.ts";

describe("Search Utilities", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.userPlaylistTrack.deleteMany();
    await prisma.userPlaylist.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  it("should search tracks by title", async () => {
    // Get or create local service for test tracks
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });

    // Create test data
    const artist = await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    await prisma.track.create({
      data: {
        title: "Test Track",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `test-track-${Date.now()}`,
      },
    });

    const result = await searchTracks("Test", 10);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.type).toBe("track");
    if (result.results[0]?.type === "track") {
      expect(result.results[0].title).toContain("Test");
    }
  });

  it("indexes new tracks into tracks_fts via insert trigger", async () => {
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Trigger Artist",
        normalizedName: "trigger artist",
      },
    });

    const track = await prisma.track.create({
      data: {
        title: "UniqueTriggerIndexedTrack",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `fts-trigger-track-${Date.now()}`,
      },
    });

    const ftsRows = await prisma.$queryRawUnsafe<Array<{ track_id: string; title: string }>>(
      `SELECT track_id, title FROM tracks_fts WHERE track_id = ?`,
      track.id,
    );
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0]?.title).toBe("UniqueTriggerIndexedTrack");

    const result = await searchTracks("UniqueTriggerIndexedTrack", 10);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.type).toBe("track");
    if (result.results[0]?.type === "track") {
      expect(result.results[0].id).toBe(track.id);
    }
  });

  it("should search albums by name", async () => {
    const artist = await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    await prisma.album.create({
      data: {
        name: "Test Album",
        artistId: artist.id,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await searchAlbums("Test", 10);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.type).toBe("album");
    if (result.results[0]?.type === "album") {
      expect(result.results[0].name).toContain("Test");
    }
  });

  it("should search artists by name", async () => {
    await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await searchArtists("Test", 10);

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.type).toBe("artist");
    if (result.results[0]?.type === "artist") {
      expect(result.results[0].name).toContain("Test");
    }
  });

  it("should search all types", async () => {
    // Get or create local service for test tracks
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    await prisma.track.create({
      data: {
        title: "Test Track",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `test-track-${Date.now()}`,
      },
    });

    await prisma.album.create({
      data: {
        name: "Test Album",
        artistId: artist.id,
      },
    });

    const result = await searchAll("Test", 10, undefined, "all");

    expect(result.results.length).toBeGreaterThan(0);
    const hasTrack = result.results.some((r) => r.type === "track");
    const hasAlbum = result.results.some((r) => r.type === "album");
    const hasArtist = result.results.some((r) => r.type === "artist");
    expect(hasTrack || hasAlbum || hasArtist).toBe(true);
  });

  it("should return empty results for empty query", async () => {
    const result = await searchAll("", 10);
    expect(result.results).toHaveLength(0);
    expect(result.pagination.hasNext).toBe(false);
  });

  it("should handle pagination", async () => {
    // Get or create local service for test tracks
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    // Create multiple tracks
    for (let i = 0; i < 5; i++) {
      await prisma.track.create({
        data: {
          title: `Test Track ${i}`,
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `test-track-${i}-${Date.now()}`,
        },
      });
    }

    const result = await searchTracks("Test", 2);
    expect(result.results.length).toBeLessThanOrEqual(2);
    // With 5 tracks and limit of 2, we should have pagination
    expect(result.pagination.hasNext).toBe(true);
  });

  it("should prioritize exact matches", async () => {
    // Get or create local service for test tracks
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Test Artist",
        normalizedName: "test artist",
      },
    });

    await prisma.track.create({
      data: {
        title: "Metal",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `test-track-metal-${Date.now()}`,
      },
    });

    await prisma.track.create({
      data: {
        title: "Metallic",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `test-track-metallic-${Date.now()}`,
      },
    });

    const result = await searchTracks("Metal", 10);
    expect(result.results.length).toBeGreaterThan(0);
    // Exact match should come first
    if (result.results[0]?.type === "track") {
      expect(result.results[0].title).toBe("Metal");
    }
  });

  describe("artist rename FTS cascade", () => {
    it("should update tracks_fts when artist is renamed", async () => {
      // Get or create local service for test tracks
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      // Create artist with old name
      const artist = await prisma.artist.create({
        data: {
          name: "Original Name",
          normalizedName: "original name",
        },
      });

      // Create a track for this artist
      await prisma.track.create({
        data: {
          title: "Test Song",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `test-track-rename-${Date.now()}`,
        },
      });

      // Rename the artist — trigger should cascade to tracks_fts
      await prisma.artist.update({
        where: { id: artist.id },
        data: { name: "New Name", normalizedName: "new name" },
      });

      // Search by new artist name should find the track
      const resultByNewName = await searchTracks("New Name", 10);
      expect(resultByNewName.results.length).toBeGreaterThan(0);
      if (resultByNewName.results[0]?.type === "track") {
        expect(resultByNewName.results[0].artistName).toContain("New Name");
      }
    });

    it("should not find tracks under old artist name after rename", async () => {
      // Get or create local service for test tracks
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      const artist = await prisma.artist.create({
        data: {
          name: "Old Band Name",
          normalizedName: "old band name",
        },
      });

      await prisma.track.create({
        data: {
          title: "Classic Hit",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `test-track-oldname-${Date.now()}`,
        },
      });

      // Rename the artist
      await prisma.artist.update({
        where: { id: artist.id },
        data: {
          name: "New Band Name",
          normalizedName: "new band name",
        },
      });

      // Old name should NOT match anymore
      const resultByOldName = await searchTracks("Old Band Name", 10);
      const oldNameMatches = resultByOldName.results.filter(
        (r) => r.type === "track" && r.artistName?.includes("Old Band Name"),
      );
      expect(oldNameMatches).toHaveLength(0);
    });

    it("should update albums_fts when artist is renamed", async () => {
      const artist = await prisma.artist.create({
        data: {
          name: "Album Artist Original",
          normalizedName: "album artist original",
        },
      });

      await prisma.album.create({
        data: {
          name: "Debut Album",
          artistId: artist.id,
        },
      });

      // Rename the artist — trigger should cascade to albums_fts
      await prisma.artist.update({
        where: { id: artist.id },
        data: {
          name: "Album Artist New",
          normalizedName: "album artist new",
        },
      });

      // Search by new artist name should find the album
      const resultByNewName = await searchAlbums("Album Artist New", 10);
      expect(resultByNewName.results.length).toBeGreaterThan(0);
      if (resultByNewName.results[0]?.type === "album") {
        expect(resultByNewName.results[0].artistName).toContain("Album Artist New");
      }
    });
  });

  describe("library-scoped search", () => {
    const timestamp = Date.now();

    it("should return only tracks in the user's library when userId is provided", async () => {
      // Get or create local service
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      // Create two users
      const userA = await prisma.user.create({
        data: {
          email: `usera-${timestamp}@test.com`,
          username: `usera-${timestamp}`,
        },
      });
      const userB = await prisma.user.create({
        data: {
          email: `userb-${timestamp}@test.com`,
          username: `userb-${timestamp}`,
        },
      });

      // Create artist
      const artist = await prisma.artist.create({
        data: {
          name: "Scoped Artist",
          normalizedName: "scoped artist",
        },
      });

      // Create tracks for both users
      const trackA = await prisma.track.create({
        data: {
          title: "User A Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `scoped-track-a-${timestamp}`,
        },
      });
      const trackB = await prisma.track.create({
        data: {
          title: "User B Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `scoped-track-b-${timestamp}`,
        },
      });

      // Associate tracks with users via UserTrack
      await prisma.userTrack.create({
        data: { userId: userA.id, trackId: trackA.id },
      });
      await prisma.userTrack.create({
        data: { userId: userB.id, trackId: trackB.id },
      });

      // User A should see only track A
      const resultA = await searchTracks("User", 10, undefined, true, userA.id);
      const trackIdsA = resultA.results.filter((r) => r.type === "track").map((r) => r.id);
      expect(trackIdsA).toContain(trackA.id);
      expect(trackIdsA).not.toContain(trackB.id);

      // User B should see only track B
      const resultB = await searchTracks("User", 10, undefined, true, userB.id);
      const trackIdsB = resultB.results.filter((r) => r.type === "track").map((r) => r.id);
      expect(trackIdsB).toContain(trackB.id);
      expect(trackIdsB).not.toContain(trackA.id);
    });

    it("should return all tracks when userId is not provided (backward compat)", async () => {
      // Get or create local service
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `public-${timestamp}@test.com`,
          username: `public-${timestamp}`,
        },
      });

      const artist = await prisma.artist.create({
        data: {
          name: "Public Artist",
          normalizedName: "public artist",
        },
      });

      const track = await prisma.track.create({
        data: {
          title: "Public Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `public-track-${timestamp}`,
        },
      });

      await prisma.userTrack.create({
        data: { userId: user.id, trackId: track.id },
      });

      // Without userId, should return the track (no scoping)
      const result = await searchTracks("Public", 10);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("should scope albums to user library via tracks", async () => {
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      const userA = await prisma.user.create({
        data: {
          email: `album-a-${timestamp}@test.com`,
          username: `album-a-${timestamp}`,
        },
      });
      const userB = await prisma.user.create({
        data: {
          email: `album-b-${timestamp}@test.com`,
          username: `album-b-${timestamp}`,
        },
      });

      const artist = await prisma.artist.create({
        data: {
          name: "Album Artist",
          normalizedName: "album artist",
        },
      });

      const albumA = await prisma.album.create({
        data: { name: "Library Album A", artistId: artist.id },
      });
      const albumB = await prisma.album.create({
        data: { name: "Library Album B", artistId: artist.id },
      });

      // Each album gets one track, owned by ONE user only
      const trackA = await prisma.track.create({
        data: {
          title: "Album Track A",
          artistId: artist.id,
          albumId: albumA.id,
          serviceId: localService.id,
          externalId: `album-track-a-${timestamp}`,
        },
      });
      const trackB = await prisma.track.create({
        data: {
          title: "Album Track B",
          artistId: artist.id,
          albumId: albumB.id,
          serviceId: localService.id,
          externalId: `album-track-b-${timestamp}`,
        },
      });

      await prisma.userTrack.create({ data: { userId: userA.id, trackId: trackA.id } });
      await prisma.userTrack.create({ data: { userId: userB.id, trackId: trackB.id } });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // User A should see album A but not album B
      const resultA = await searchAlbums("Library Album", 10, undefined, true, userA.id);
      const albumIdsA = resultA.results.filter((r) => r.type === "album").map((r) => r.id);
      expect(albumIdsA).toContain(albumA.id);
      expect(albumIdsA).not.toContain(albumB.id);

      // User B should see album B but not album A
      const resultB = await searchAlbums("Library Album", 10, undefined, true, userB.id);
      const albumIdsB = resultB.results.filter((r) => r.type === "album").map((r) => r.id);
      expect(albumIdsB).toContain(albumB.id);
      expect(albumIdsB).not.toContain(albumA.id);
    });

    it("should scope artists to user library via tracks", async () => {
      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      const userA = await prisma.user.create({
        data: {
          email: `artist-a-${timestamp}@test.com`,
          username: `artist-a-${timestamp}`,
        },
      });
      const userB = await prisma.user.create({
        data: {
          email: `artist-b-${timestamp}@test.com`,
          username: `artist-b-${timestamp}`,
        },
      });

      const artistA = await prisma.artist.create({
        data: { name: "Library Artist A", normalizedName: "library artist a" },
      });
      const artistB = await prisma.artist.create({
        data: { name: "Library Artist B", normalizedName: "library artist b" },
      });

      const trackA = await prisma.track.create({
        data: {
          title: "Artist Track A",
          artistId: artistA.id,
          serviceId: localService.id,
          externalId: `artist-track-a-${timestamp}`,
        },
      });
      const trackB = await prisma.track.create({
        data: {
          title: "Artist Track B",
          artistId: artistB.id,
          serviceId: localService.id,
          externalId: `artist-track-b-${timestamp}`,
        },
      });

      await prisma.userTrack.create({ data: { userId: userA.id, trackId: trackA.id } });
      await prisma.userTrack.create({ data: { userId: userB.id, trackId: trackB.id } });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // User A should see artist A but not artist B
      const resultA = await searchArtists("Library Artist", 10, undefined, true, userA.id);
      const artistIdsA = resultA.results.filter((r) => r.type === "artist").map((r) => r.id);
      expect(artistIdsA).toContain(artistA.id);
      expect(artistIdsA).not.toContain(artistB.id);

      // User B should see artist B but not artist A
      const resultB = await searchArtists("Library Artist", 10, undefined, true, userB.id);
      const artistIdsB = resultB.results.filter((r) => r.type === "artist").map((r) => r.id);
      expect(artistIdsB).toContain(artistB.id);
      expect(artistIdsB).not.toContain(artistA.id);
    });
  });

  describe("playlist search", () => {
    it("should search playlists by title for a specific user", async () => {
      // Create a test user
      const user = await prisma.user.create({
        data: {
          username: `testuser-${Date.now()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create a playlist for this user
      const playlist = await prisma.userPlaylist.create({
        data: {
          title: "My Favorite Songs",
          ownerId: user.id,
        },
      });

      const result = await searchPlaylists("Favorite", user.id, 10);

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0]?.type).toBe("playlist");
      if (result.results[0]?.type === "playlist") {
        expect(result.results[0].name).toContain("Favorite");
        expect(result.results[0].trackCount).toBe(0);
      }
    });

    it("should scope playlist search to the authenticated user only", async () => {
      // Create two users
      const userA = await prisma.user.create({
        data: {
          username: `user-a-${Date.now()}`,
          email: `user-a-${Date.now()}@example.com`,
          name: "User A",
        },
      });

      const userB = await prisma.user.create({
        data: {
          username: `user-b-${Date.now()}`,
          email: `user-b-${Date.now()}@example.com`,
          name: "User B",
        },
      });

      // Create a playlist for user A only
      await prisma.userPlaylist.create({
        data: {
          title: "User A Playlist",
          ownerId: userA.id,
        },
      });

      // User B should not find user A's playlists
      const resultForB = await searchPlaylists("Playlist", userB.id, 10);
      expect(resultForB.results).toHaveLength(0);

      // User A should find their own playlist
      const resultForA = await searchPlaylists("Playlist", userA.id, 10);
      expect(resultForA.results.length).toBeGreaterThan(0);
      if (resultForA.results[0]?.type === "playlist") {
        expect(resultForA.results[0].name).toContain("User A");
      }
    });

    it("should return playlist with track count", async () => {
      const user = await prisma.user.create({
        data: {
          username: `trackcount-${Date.now()}`,
          email: `trackcount-${Date.now()}@example.com`,
          name: "Track Count User",
        },
      });

      const localService = await prisma.service.upsert({
        where: { name: "local" },
        update: {},
        create: {
          name: "local",
          displayName: "Local Upload",
          baseUrl: "",
          isActive: true,
        },
      });

      const artist = await prisma.artist.create({
        data: { name: "Test Artist", normalizedName: "test artist" },
      });

      const playlist = await prisma.userPlaylist.create({
        data: {
          title: "My Tracks",
          ownerId: user.id,
        },
      });

      // Add 3 tracks to the playlist
      for (let i = 0; i < 3; i++) {
        const track = await prisma.track.create({
          data: {
            title: `Track ${i}`,
            artistId: artist.id,
            serviceId: localService.id,
            externalId: `playlist-track-${i}-${Date.now()}`,
          },
        });
        await prisma.userPlaylistTrack.create({
          data: {
            playlistId: playlist.id,
            trackId: track.id,
            position: i,
          },
        });
      }

      const result = await searchPlaylists("Tracks", user.id, 10);
      expect(result.results.length).toBeGreaterThan(0);
      if (result.results[0]?.type === "playlist") {
        expect(result.results[0].trackCount).toBe(3);
      }
    });

    it("should return empty results when no userId provided", async () => {
      const result = await searchPlaylists("anything", "", 10);
      expect(result.results).toHaveLength(0);
    });

    it("should return empty results for empty query", async () => {
      const user = await prisma.user.create({
        data: {
          username: `emptyquery-${Date.now()}`,
          email: `emptyquery-${Date.now()}@example.com`,
          name: "Empty Query",
        },
      });

      await prisma.userPlaylist.create({
        data: { title: "Test Playlist", ownerId: user.id },
      });

      const result = await searchPlaylists("", user.id, 10);
      expect(result.results).toHaveLength(0);
    });
  });
});

/**
 * Unit tests for search functionality
 */

import { describe, it, expect, beforeEach } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
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
    await prisma.usageEvent.deleteMany();
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

  it("should enrich track search results with playback and action fields", async () => {
    const timestamp = Date.now();
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
        email: `enriched-${timestamp}@test.com`,
        username: `enriched-${timestamp}`,
      },
    });

    const artist = await prisma.artist.create({
      data: {
        name: "Enriched Artist",
        normalizedName: "enriched artist",
      },
    });

    const track = await prisma.track.create({
      data: {
        title: "Enriched Track",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `enriched-track-${timestamp}`,
        serviceUrl: "https://youtube.com/watch?v=enriched",
        duration: 240,
      },
    });

    await prisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        serviceId: track.serviceId,
        objectKey: `audio/enriched-${timestamp}.mp3`,
        format: "mp3",
      },
    });

    const userTrack = await prisma.userTrack.create({
      data: { userId: user.id, trackId: track.id },
    });

    const result = await searchTracks("Enriched", 10, undefined, true, user.id);

    expect(result.results.length).toBeGreaterThan(0);
    const trackResult = result.results.find((r) => r.type === "track" && r.id === track.id);
    expect(trackResult?.type).toBe("track");
    if (trackResult?.type === "track") {
      expect(trackResult.serviceUrl).toBe("https://youtube.com/watch?v=enriched");
      expect(trackResult.service).toEqual({
        displayName: "Local Upload",
        logoUrl: null,
      });
      expect(trackResult.audioFiles).toEqual([
        expect.objectContaining({
          objectKey: `audio/enriched-${timestamp}.mp3`,
          format: "mp3",
        }),
      ]);
      expect(trackResult.addedAt).toBe(userTrack.createdAt.toISOString());
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

      // User A should see only track A with scope='library'
      const resultA = await searchTracks("User", 10, undefined, true, userA.id, "library");
      const trackIdsA = resultA.results.filter((r) => r.type === "track").map((r) => r.id);
      expect(trackIdsA).toContain(trackA.id);
      expect(trackIdsA).not.toContain(trackB.id);

      // User B should see only track B with scope='library'
      const resultB = await searchTracks("User", 10, undefined, true, userB.id, "library");
      const trackIdsB = resultB.results.filter((r) => r.type === "track").map((r) => r.id);
      expect(trackIdsB).toContain(trackB.id);
      expect(trackIdsB).not.toContain(trackA.id);
    });

    it("scope='all' should return all tracks even with userId", async () => {
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
          email: `all-scope-${timestamp}@test.com`,
          username: `all-scope-${timestamp}`,
        },
      });

      const artist = await prisma.artist.create({
        data: {
          name: "All Scope Artist",
          normalizedName: "all scope artist",
        },
      });

      const trackInLibrary = await prisma.track.create({
        data: {
          title: "In Library Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `in-library-track-${timestamp}`,
        },
      });

      const trackNotInLibrary = await prisma.track.create({
        data: {
          title: "Not In Library Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `not-in-library-track-${timestamp}`,
        },
      });

      await prisma.userTrack.create({
        data: { userId: user.id, trackId: trackInLibrary.id },
      });

      // With scope='all', should return both tracks
      const result = await searchTracks("Track", 10, undefined, true, user.id, "all");
      const trackIds = result.results.filter((r) => r.type === "track").map((r) => r.id);
      expect(trackIds).toContain(trackInLibrary.id);
      expect(trackIds).toContain(trackNotInLibrary.id);
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

      // User A should see album A but not album B with scope='library'
      const resultA = await searchAlbums("Library Album", 10, undefined, true, userA.id, "library");
      const albumIdsA = resultA.results.filter((r) => r.type === "album").map((r) => r.id);
      expect(albumIdsA).toContain(albumA.id);
      expect(albumIdsA).not.toContain(albumB.id);

      // User B should see album B but not album A with scope='library'
      const resultB = await searchAlbums("Library Album", 10, undefined, true, userB.id, "library");
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

      // User A should see artist A but not artist B with scope='library'
      const resultA = await searchArtists(
        "Library Artist",
        10,
        undefined,
        true,
        userA.id,
        "library",
      );
      const artistIdsA = resultA.results.filter((r) => r.type === "artist").map((r) => r.id);
      expect(artistIdsA).toContain(artistA.id);
      expect(artistIdsA).not.toContain(artistB.id);

      // User B should see artist B but not artist A with scope='library'
      const resultB = await searchArtists(
        "Library Artist",
        10,
        undefined,
        true,
        userB.id,
        "library",
      );
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
      await prisma.userPlaylist.create({
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

    it("guests cannot enumerate another user's playlists via searchAll", async () => {
      const owner = await prisma.user.create({
        data: {
          username: `guest-enum-${Date.now()}`,
          email: `guest-enum-${Date.now()}@example.com`,
          name: "Guest Enum Owner",
        },
      });

      await prisma.userPlaylist.create({
        data: { title: "Private Playlist", ownerId: owner.id },
      });

      // type=playlists with no userId → empty (searchAll gates on userId)
      const playlistsOnly = await searchAll("Private", 10, undefined, "playlists");
      expect(playlistsOnly.results).toHaveLength(0);

      // type=all with no userId → playlist results are never included
      const allTypes = await searchAll("Private", 10, undefined, "all");
      expect(allTypes.results.filter((r) => r.type === "playlist")).toHaveLength(0);
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

  describe("resilient special-character queries", () => {
    it("does not throw for punctuation-only or FTS operator queries", async () => {
      const queries = ["-", "*", "***", "???", "AND", "OR", "NOT", "NEAR(", "col:name", "^start"];
      for (const q of queries) {
        await expect(searchAll(q, 10)).resolves.toMatchObject({
          results: expect.any(Array),
          pagination: expect.objectContaining({ hasNext: expect.any(Boolean) }),
        });
      }
    });

    it("finds hyphenated artist names", async () => {
      const artist = await prisma.artist.create({
        data: {
          name: "AC-DC",
          normalizedName: "ac-dc",
        },
      });

      const result = await searchArtists("AC-DC", 10);
      expect(result.results.some((r) => r.type === "artist" && r.id === artist.id)).toBe(true);
    });

    it("finds tracks when mid-typing a hyphenated prefix", async () => {
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
          name: "Hyphen Artist",
          normalizedName: "hyphen artist",
        },
      });

      await prisma.track.create({
        data: {
          title: "Rock-n-Roll",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `hyphen-track-${Date.now()}`,
        },
      });

      const result = await searchTracks("Rock-", 10);
      expect(result.results.some((r) => r.type === "track" && r.title === "Rock-n-Roll")).toBe(
        true,
      );
    });
  });

  describe("Personal Play Boost (ADR-028)", () => {
    async function seedBoostFixture() {
      const timestamp = Date.now();
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
          email: `boost-${timestamp}@test.com`,
          username: `boost-${timestamp}`,
        },
      });
      const otherUser = await prisma.user.create({
        data: {
          email: `boost-other-${timestamp}@test.com`,
          username: `boost-other-${timestamp}`,
        },
      });

      const artist = await prisma.artist.create({
        data: {
          name: "Boost Artist",
          normalizedName: "boost artist",
        },
      });

      // Same contains-tier titles for query "Boost"; Alpha sorts before Zebra by title.
      const familiar = await prisma.track.create({
        data: {
          title: "Zebra Boost Familiar Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `boost-familiar-${timestamp}`,
        },
      });
      const unfamiliar = await prisma.track.create({
        data: {
          title: "Alpha Boost Unfamiliar Track",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `boost-unfamiliar-${timestamp}`,
        },
      });
      // Exact title match for query "Song" — zero plays must still beat contains+plays.
      const exactUnused = await prisma.track.create({
        data: {
          title: "Song",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `boost-exact-${timestamp}`,
        },
      });
      const containsHeavy = await prisma.track.create({
        data: {
          title: "Midnight Song Reprise",
          artistId: artist.id,
          serviceId: localService.id,
          externalId: `boost-contains-heavy-${timestamp}`,
        },
      });

      await prisma.userTrack.createMany({
        data: [familiar, unfamiliar, exactUnused, containsHeavy].map((track) => ({
          userId: user.id,
          trackId: track.id,
        })),
      });

      const play = (userId: string, trackId: string) => ({
        type: USAGE_EVENT_TYPES.play_completed,
        userId,
        trackId,
      });
      // One insert for the personal boost, the other user's plays, and the
      // contains-match plays. Sequential creates blew the 5s test timeout in CI.
      await prisma.usageEvent.createMany({
        data: [
          ...Array.from({ length: 12 }, () => play(user.id, familiar.id)),
          ...Array.from({ length: 50 }, () => play(otherUser.id, unfamiliar.id)),
          ...Array.from({ length: 80 }, () => play(user.id, containsHeavy.id)),
        ],
      });

      return { user, familiar, unfamiliar, exactUnused, containsHeavy };
    }

    it("soft-boosts personal lifetime plays among matching tracks when authed", async () => {
      const { user, familiar, unfamiliar } = await seedBoostFixture();

      const result = await searchTracks("Boost", 10, undefined, true, user.id);
      const trackIds = result.results.filter((r) => r.type === "track").map((r) => r.id);

      expect(trackIds).toContain(familiar.id);
      expect(trackIds).toContain(unfamiliar.id);
      expect(trackIds.indexOf(familiar.id)).toBeLessThan(trackIds.indexOf(unfamiliar.id));
    }, 10000);

    it("applies personal play boost within library-scoped search", async () => {
      const { user, familiar, unfamiliar } = await seedBoostFixture();

      // scope="library" exercises the bound `ut."userId" = ?` join param and the
      // boost CASE `?` params in one query, so a regressed placeholder order
      // surfaces as either a throw or a dropped boost.
      const result = await searchTracks("Boost", 10, undefined, true, user.id, "library");
      const trackIds = result.results.filter((r) => r.type === "track").map((r) => r.id);

      expect(trackIds).toContain(familiar.id);
      expect(trackIds).toContain(unfamiliar.id);
      expect(trackIds.indexOf(familiar.id)).toBeLessThan(trackIds.indexOf(unfamiliar.id));
    }, 10000);

    it("does not apply personal play boost when logged out (relevance only)", async () => {
      const { familiar, unfamiliar } = await seedBoostFixture();

      const result = await searchTracks("Boost", 10);
      const trackIds = result.results.filter((r) => r.type === "track").map((r) => r.id);

      expect(trackIds).toContain(familiar.id);
      expect(trackIds).toContain(unfamiliar.id);
      // Without boost, title ASC tie-break puts Alpha before Zebra.
      expect(trackIds.indexOf(unfamiliar.id)).toBeLessThan(trackIds.indexOf(familiar.id));
    }, 10000);

    it("does not hard-override relevance: exact match beats contains despite plays", async () => {
      const { user, exactUnused, containsHeavy } = await seedBoostFixture();

      const result = await searchTracks("Song", 10, undefined, true, user.id);
      const trackIds = result.results.filter((r) => r.type === "track").map((r) => r.id);

      expect(trackIds[0]).toBe(exactUnused.id);
      expect(trackIds.indexOf(exactUnused.id)).toBeLessThan(trackIds.indexOf(containsHeavy.id));
    }, 10000);
  });
});

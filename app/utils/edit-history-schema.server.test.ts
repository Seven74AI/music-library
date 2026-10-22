import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";

describe("Edit History Schema", () => {
  let testUserId: string;
  let testArtistId: string;
  let testAlbumId: string;
  let testTrackId: string;
  let testServiceId: string;

  beforeEach(async () => {
    // Create test user
    testUserId = await prisma.user
      .create({
        data: {
          email: `test-${Date.now()}@example.com`,
          username: `test-${Date.now()}`,
        },
      })
      .then((u) => u.id);

    // Create test service
    testServiceId = await prisma.service
      .findFirst({ where: { name: "local" } })
      .then((s) => s?.id || "");

    // Create test artist
    testArtistId = await prisma.artist
      .create({
        data: {
          name: `Test Artist ${Date.now()}`,
          normalizedName: `test artist ${Date.now()}`,
        },
      })
      .then((a) => a.id);

    // Create test album
    testAlbumId = await prisma.album
      .create({
        data: {
          name: `Test Album ${Date.now()}`,
          artistId: testArtistId,
        },
      })
      .then((a) => a.id);

    // Create test track
    testTrackId = await prisma.track
      .create({
        data: {
          title: `Test Track ${Date.now()}`,
          artistId: testArtistId,
          serviceId: testServiceId,
          externalId: `test-${Date.now()}`,
        },
      })
      .then((t) => t.id);
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.track.deleteMany({ where: { id: testTrackId } }).catch(() => {});
    await prisma.album.deleteMany({ where: { id: testAlbumId } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: testArtistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
  });

  describe("TrackEdit table", () => {
    test("can create track edit record with full snapshot", async () => {
      const trackEdit = await prisma.trackEdit.create({
        data: {
          trackId: testTrackId,
          editedBy: testUserId,
          comment: "Initial snapshot",
          title: "Original Title",
          artistId: testArtistId,
          albumId: testAlbumId,
          genre: "Rock",
          genreIds: JSON.stringify(["genre-rock", "genre-jazz"]),
          year: 2024,
          trackNumber: 1,
          albumArtist: "Test Artist",
          bpm: 120,
          label: "Test Label",
          isrc: "USABC1234567",
          releaseDate: new Date("2024-01-01"),
          originalDate: new Date("2023-12-01"),
          originalYear: 2023,
          totalTracks: 10,
          totalDiscs: 1,
          lyrics: "Test lyrics",
        },
      });

      expect(trackEdit.id).toBeDefined();
      expect(trackEdit.title).toBe("Original Title");
      expect(trackEdit.comment).toBe("Initial snapshot");
      expect(trackEdit.genreIds).toBe(JSON.stringify(["genre-rock", "genre-jazz"]));
      expect(trackEdit.editedAt).toBeInstanceOf(Date);
    });

    test("has proper cascade delete on track deletion", async () => {
      // Create edit record
      const trackEdit = await prisma.trackEdit.create({
        data: {
          trackId: testTrackId,
          editedBy: testUserId,
          title: "Test",
          artistId: testArtistId,
        },
      });

      // Delete track
      await prisma.track.delete({ where: { id: testTrackId } });

      // Verify edit was cascade deleted
      const deletedEdit = await prisma.trackEdit.findUnique({
        where: { id: trackEdit.id },
      });
      expect(deletedEdit).toBeNull();
    });

    test("has proper cascade delete on user deletion", async () => {
      // Create another user for this test
      const tempUser = await prisma.user.create({
        data: {
          email: `temp-${Date.now()}@example.com`,
          username: `temp-${Date.now()}`,
        },
      });

      // Create edit record
      const trackEdit = await prisma.trackEdit.create({
        data: {
          trackId: testTrackId,
          editedBy: tempUser.id,
          title: "Test",
          artistId: testArtistId,
        },
      });

      // Delete user
      await prisma.user.delete({ where: { id: tempUser.id } });

      // Verify edit was cascade deleted
      const deletedEdit = await prisma.trackEdit.findUnique({
        where: { id: trackEdit.id },
      });
      expect(deletedEdit).toBeNull();
    });

    test("can query edits by track and order by editedAt", async () => {
      // Create multiple edits
      await prisma.trackEdit.create({
        data: {
          trackId: testTrackId,
          editedBy: testUserId,
          title: "Version 1",
          artistId: testArtistId,
          editedAt: new Date("2024-01-01"),
        },
      });

      await prisma.trackEdit.create({
        data: {
          trackId: testTrackId,
          editedBy: testUserId,
          title: "Version 2",
          artistId: testArtistId,
          editedAt: new Date("2024-01-02"),
        },
      });

      // Query edits ordered by date
      const edits = await prisma.trackEdit.findMany({
        where: { trackId: testTrackId },
        orderBy: { editedAt: "asc" },
      });

      expect(edits).toHaveLength(2);
      expect(edits[0]?.title).toBe("Version 1");
      expect(edits[1]?.title).toBe("Version 2");
    });
  });

  describe("ArtistEdit table", () => {
    test("can create artist edit record with full snapshot", async () => {
      const artistEdit = await prisma.artistEdit.create({
        data: {
          artistId: testArtistId,
          editedBy: testUserId,
          comment: "Updated artist info",
          name: "Updated Artist Name",
          bio: "Artist biography",
          imageUrl: "https://example.com/artist.jpg",
          website: "https://artist.example.com",
          genre: "Rock",
          country: "US",
        },
      });

      expect(artistEdit.id).toBeDefined();
      expect(artistEdit.name).toBe("Updated Artist Name");
      expect(artistEdit.comment).toBe("Updated artist info");
    });

    test("has proper cascade delete on artist deletion", async () => {
      const artistEdit = await prisma.artistEdit.create({
        data: {
          artistId: testArtistId,
          editedBy: testUserId,
          name: "Test",
        },
      });

      await prisma.artist.delete({ where: { id: testArtistId } });

      const deletedEdit = await prisma.artistEdit.findUnique({
        where: { id: artistEdit.id },
      });
      expect(deletedEdit).toBeNull();
    });
  });

  describe("AlbumEdit table", () => {
    test("can create album edit record with full snapshot", async () => {
      const albumEdit = await prisma.albumEdit.create({
        data: {
          albumId: testAlbumId,
          editedBy: testUserId,
          comment: "Fixed album metadata",
          name: "Updated Album Name",
          artistId: testArtistId,
          year: 2024,
        },
      });

      expect(albumEdit.id).toBeDefined();
      expect(albumEdit.name).toBe("Updated Album Name");
      expect(albumEdit.year).toBe(2024);
    });

    test("has proper cascade delete on album deletion", async () => {
      const albumEdit = await prisma.albumEdit.create({
        data: {
          albumId: testAlbumId,
          editedBy: testUserId,
          name: "Test",
          artistId: testArtistId,
        },
      });

      await prisma.album.delete({ where: { id: testAlbumId } });

      const deletedEdit = await prisma.albumEdit.findUnique({
        where: { id: albumEdit.id },
      });
      expect(deletedEdit).toBeNull();
    });
  });

  describe("Artist merge tracking", () => {
    test("Artist model has merge tracking fields", async () => {
      const targetArtist = await prisma.artist.create({
        data: {
          name: `Target Artist ${Date.now()}`,
          normalizedName: `target artist ${Date.now()}`,
        },
      });

      const mergedArtist = await prisma.artist.create({
        data: {
          name: `Merged Artist ${Date.now()}`,
          normalizedName: `merged artist ${Date.now()}`,
          mergedIntoId: targetArtist.id,
          mergedAt: new Date(),
          mergedBy: testUserId,
        },
      });

      expect(mergedArtist.mergedIntoId).toBe(targetArtist.id);
      expect(mergedArtist.mergedAt).toBeInstanceOf(Date);
      expect(mergedArtist.mergedBy).toBe(testUserId);

      // Verify relation
      const artistWithMerged = await prisma.artist.findUnique({
        where: { id: targetArtist.id },
        include: { mergedFrom: true },
      });

      expect(artistWithMerged?.mergedFrom).toHaveLength(1);
      expect(artistWithMerged?.mergedFrom[0]?.id).toBe(mergedArtist.id);

      // Cleanup
      await prisma.artist.deleteMany({
        where: { id: { in: [mergedArtist.id, targetArtist.id] } },
      });
    });

    test("can query all artists merged into a target", async () => {
      const targetArtist = await prisma.artist.create({
        data: {
          name: `Target ${Date.now()}`,
          normalizedName: `target ${Date.now()}`,
        },
      });

      // Create multiple merged artists
      const merged1 = await prisma.artist.create({
        data: {
          name: `Merged 1 ${Date.now()}`,
          normalizedName: `merged 1 ${Date.now()}`,
          mergedIntoId: targetArtist.id,
          mergedAt: new Date(),
        },
      });

      const merged2 = await prisma.artist.create({
        data: {
          name: `Merged 2 ${Date.now()}`,
          normalizedName: `merged 2 ${Date.now()}`,
          mergedIntoId: targetArtist.id,
          mergedAt: new Date(),
        },
      });

      const mergedArtists = await prisma.artist.findMany({
        where: { mergedIntoId: targetArtist.id },
      });

      expect(mergedArtists).toHaveLength(2);

      // Cleanup
      await prisma.artist.deleteMany({
        where: { id: { in: [merged1.id, merged2.id, targetArtist.id] } },
      });
    });
  });

  describe("Album merge tracking", () => {
    test("Album model has merge tracking fields", async () => {
      const targetAlbum = await prisma.album.create({
        data: {
          name: `Target Album ${Date.now()}`,
          artistId: testArtistId,
        },
      });

      const mergedAlbum = await prisma.album.create({
        data: {
          name: `Merged Album ${Date.now()}`,
          artistId: testArtistId,
          mergedIntoId: targetAlbum.id,
          mergedAt: new Date(),
          mergedBy: testUserId,
        },
      });

      expect(mergedAlbum.mergedIntoId).toBe(targetAlbum.id);
      expect(mergedAlbum.mergedAt).toBeInstanceOf(Date);
      expect(mergedAlbum.mergedBy).toBe(testUserId);

      // Verify relation
      const albumWithMerged = await prisma.album.findUnique({
        where: { id: targetAlbum.id },
        include: { mergedFrom: true },
      });

      expect(albumWithMerged?.mergedFrom).toHaveLength(1);
      expect(albumWithMerged?.mergedFrom[0]?.id).toBe(mergedAlbum.id);

      // Cleanup
      await prisma.album.deleteMany({
        where: { id: { in: [mergedAlbum.id, targetAlbum.id] } },
      });
    });
  });

  describe("Curator role and permissions", () => {
    test("curator role exists with correct permissions", async () => {
      const curatorRole = await prisma.role.findUnique({
        where: { name: "curator" },
        include: { permissions: true },
      });

      expect(curatorRole).not.toBeNull();
      expect(curatorRole?.name).toBe("curator");
      expect(curatorRole?.description).toContain("edit track/artist/album metadata");

      // Verify required permissions exist
      const permissionKeys = curatorRole?.permissions.map(
        (p) => `${p.action}:${p.entity}:${p.access}`,
      );

      expect(permissionKeys).toContain("update:metadata:any");
      expect(permissionKeys).toContain("read:metadata-history:any");
      expect(permissionKeys).toContain("restore:metadata:any");
      expect(permissionKeys).toContain("update:artist:any");
      expect(permissionKeys).toContain("merge:artist:any");
      expect(permissionKeys).toContain("update:album:any");
      expect(permissionKeys).toContain("merge:album:any");
    });

    test("curator role has exactly 7 permissions", async () => {
      const curatorRole = await prisma.role.findUnique({
        where: { name: "curator" },
        include: { permissions: true },
      });

      expect(curatorRole?.permissions).toHaveLength(7);
    });
  });
});

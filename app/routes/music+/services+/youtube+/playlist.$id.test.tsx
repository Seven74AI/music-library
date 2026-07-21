/**
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { type TrackWithUserStatus } from "#app/types/frontend/shared";
import { mapTrackToListItem } from "./playlist.$id";

test("mapTrackToListItem includes audioFiles when present", () => {
  const track: TrackWithUserStatus = {
    id: "track-1",
    title: "Test Song",
    artist: { id: "artist-1", name: "Test Artist" },
    duration: 180,
    coverImage: null,
    thumbnailUrl: null,
    serviceUrl: "https://youtube.com/watch?v=test",
    service: { name: "youtube", displayName: "YouTube", logoUrl: null },
    audioFiles: [
      { id: "af-1", format: "mp3", objectKey: "tracks/test.mp3" },
      { id: "af-2", format: "flac", objectKey: "tracks/test.flac" },
    ],
    position: 0,
    isInUserLibrary: false,
    externalId: "ext-1",
    serviceId: "svc-1",
    releaseDate: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  const result = mapTrackToListItem(track);

  expect(result.audioFiles).toBeDefined();
  expect(result.audioFiles).toHaveLength(2);
  const files = result.audioFiles!;
  expect(files[0]!.id).toBe("af-1");
  expect(files[0]!.format).toBe("mp3");
  expect(files[0]!.objectKey).toBe("tracks/test.mp3");
});

test("mapTrackToListItem handles undefined audioFiles", () => {
  const track: TrackWithUserStatus = {
    id: "track-2",
    title: "No Audio",
    artist: { id: "artist-1", name: "Test Artist" },
    duration: null,
    coverImage: null,
    thumbnailUrl: null,
    serviceUrl: null,
    service: undefined,
    audioFiles: undefined,
    position: 0,
    isInUserLibrary: false,
    externalId: "ext-2",
    serviceId: "svc-2",
    releaseDate: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  const result = mapTrackToListItem(track);

  expect(result.audioFiles).toBeUndefined();
});

test("mapTrackToListItem maps all basic fields", () => {
  const track: TrackWithUserStatus = {
    id: "track-3",
    title: "Full Track",
    artist: { id: "artist-3", name: "Full Artist" },
    duration: 240,
    coverImage: { objectKey: "covers/test.jpg" },
    thumbnailUrl: "https://example.com/thumb.jpg",
    serviceUrl: "https://youtube.com/watch?v=full",
    service: { name: "youtube", displayName: "YouTube", logoUrl: "https://example.com/yt.png" },
    audioFiles: [],
    position: 0,
    isInUserLibrary: true,
    externalId: "ext-3",
    serviceId: "svc-3",
    releaseDate: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  const result = mapTrackToListItem(track);

  expect(result.id).toBe("track-3");
  expect(result.title).toBe("Full Track");
  expect(result.artist).toEqual({ id: "artist-3", name: "Full Artist" });
  expect(result.duration).toBe(240);
  expect(result.coverImage).toEqual({ objectKey: "covers/test.jpg" });
  expect(result.thumbnailUrl).toBe("https://example.com/thumb.jpg");
  expect(result.serviceUrl).toBe("https://youtube.com/watch?v=full");
  expect(result.service).toEqual({ displayName: "YouTube", logoUrl: "https://example.com/yt.png" });
  expect(result.audioFiles).toEqual([]);
});

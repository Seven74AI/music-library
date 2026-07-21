import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { type FullTrack } from "#app/types/frontend/shared.ts";
import {
  AuthExpiredError,
  fetchQueueSpine,
  fullTrackStubFromQueueTrack,
  queueTrackFromFullTrack,
} from "./queue-spine.ts";

const fullTrack: FullTrack = {
  id: "track-1",
  title: "Song",
  artist: { id: "artist-1", name: "Artist" },
  duration: 120,
  coverImage: null,
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/test.mp3" }],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queueTrackFromFullTrack", () => {
  test("projects minimal queue fields", () => {
    expect(queueTrackFromFullTrack(fullTrack)).toEqual({
      id: "track-1",
      title: "Song",
      artist: { id: "artist-1", name: "Artist" },
    });
  });
});

describe("fetchQueueSpine", () => {
  test("requests library spine with hasAudio=1", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [], total: 0 }),
    } as Response);

    await fetchQueueSpine({ type: "library" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/queue-spine?context=library&hasAudio=1",
    );
  });

  test("requests playlist spine with playlistId", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tracks: [], total: 0 }),
    } as Response);

    await fetchQueueSpine({ type: "playlist", playlistId: "pl-1" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("context=playlist");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("playlistId=pl-1");
  });

  test("throws AuthExpiredError on redirect (302) response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
    } as Response);

    await expect(fetchQueueSpine({ type: "library" })).rejects.toThrow(AuthExpiredError);
  });

  test("throws generic Error on non-redirect error response (500)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchQueueSpine({ type: "library" })).rejects.toThrow(
      "Failed to fetch queue spine: 500",
    );
  });
});

describe("fullTrackStubFromQueueTrack", () => {
  test("creates a non-playable full-track placeholder", () => {
    const stub = fullTrackStubFromQueueTrack(queueTrackFromFullTrack(fullTrack));
    expect(stub.audioFiles).toEqual([]);
    expect(stub.id).toBe("track-1");
  });
});

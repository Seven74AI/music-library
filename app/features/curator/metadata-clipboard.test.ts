import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildPastePayload,
  clearMetadataClipboard,
  copyMetadata,
  pasteMetadataRequest,
  pasteSelectedMetadata,
  type ClipboardTrack,
  type MetadataClipboard,
} from "./metadata-clipboard.ts";

const source: MetadataClipboard = {
  artistId: "artist-source",
  artistName: "Source Artist",
  albumId: "album-source",
  albumName: "Source Album",
  genre: "Jazz",
  genreIds: ["genre-jazz"],
  year: 1974,
  albumArtist: "Source Album Artist",
  bpm: 120,
  label: "Blue Note",
};

const current: ClipboardTrack = {
  title: "Target Title",
  artistId: "artist-current",
  artistName: "Current Artist",
  albumId: "album-current",
  albumName: "Current Album",
  genre: "Rock",
  genreIds: ["genre-rock"],
  year: 1999,
  albumArtist: "Current Album Artist",
  bpm: 90,
  label: "Current Label",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const currentDetails = {
  track: {
    title: current.title,
    artist: { id: current.artistId, name: current.artistName },
    albumRecord: { id: current.albumId, name: current.albumName },
    genre: current.genre,
    genres: [{ id: "genre-rock", name: "Rock" }],
    year: current.year,
    albumArtist: current.albumArtist,
    bpm: current.bpm,
    label: current.label,
  },
};

afterEach(() => {
  clearMetadataClipboard();
  vi.unstubAllGlobals();
});

describe("metadata clipboard field selection", () => {
  test("applies only the selected fields and keeps the rest of the target track", () => {
    const payload = buildPastePayload(current, source, ["artist", "year", "label"]);
    expect(payload).toEqual({
      title: "Target Title",
      artistId: "artist-source",
      albumId: "album-current",
      genre: "Rock",
      genreIds: ["genre-rock"],
      year: 1974,
      albumArtist: "Current Album Artist",
      bpm: 90,
      label: "Blue Note",
      comment: "Pasted metadata",
    });
  });

  test("selecting genre replaces genre ids and leaves artist alone", () => {
    const payload = buildPastePayload(current, source, ["genre"]);
    expect(payload.artistId).toBe("artist-current");
    expect(payload.genre).toBe("Jazz");
    expect(payload.genreIds).toEqual(["genre-jazz"]);
  });
});

describe("metadata clipboard edit request", () => {
  test("posts the selected payload to the existing track edit endpoint", async () => {
    copyMetadata(source);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(currentDetails))
      .mockResolvedValueOnce(jsonResponse({ track: { id: "track-2" }, edit: { id: "edit-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await pasteSelectedMetadata("track-2", ["album", "bpm"], fetchMock);
    const request = pasteMetadataRequest("track-2", payload);

    expect(payload.albumId).toBe("album-source");
    expect(payload.bpm).toBe(120);
    expect(payload.year).toBe(1999);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/resources/track-details?trackId=track-2",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, request.url, {
      method: "POST",
      credentials: "same-origin",
      headers: request.headers,
      body: request.body,
    });
    expect(request.url).toBe("/api/metadata/tracks/track-2/edit");
    expect(JSON.parse(request.body)).toMatchObject({
      title: "Target Title",
      artistId: "artist-current",
      albumId: "album-source",
      bpm: 120,
      comment: "Pasted metadata",
    });
  });

  test("retries a failed edit request before succeeding", async () => {
    copyMetadata(source);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(currentDetails))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ edit: { id: "edit-2" } }));
    await pasteSelectedMetadata("track-2", ["year"], fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

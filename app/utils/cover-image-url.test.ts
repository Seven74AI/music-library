import { describe, expect, test } from "vitest";
import {
  albumCardCoverPixelSize,
  coverImageUrl,
  entityHeaderCoverPixelSize,
  nowPlayingCoverPixelSize,
  playlistCoverPixelSizes,
  trackThumbnailPixelSizes,
} from "./cover-image-url.ts";

describe("coverImageUrl", () => {
  test("builds a square proxied cover URL", () => {
    expect(coverImageUrl("images/tracks/a/cover.jpg", 128)).toBe(
      "/resources/images?src=images%2Ftracks%2Fa%2Fcover.jpg&w=128&h=128&fit=cover&format=webp",
    );
  });

  test("returns empty string when objectKey is null", () => {
    expect(coverImageUrl(null, 128)).toBe("");
  });

  test("returns empty string when objectKey is undefined", () => {
    expect(coverImageUrl(undefined, 128)).toBe("");
  });

  test("returns empty string when objectKey is empty string", () => {
    expect(coverImageUrl("", 128)).toBe("");
  });
});

describe("pixel size maps", () => {
  test("uses 2x track thumbnail sizes for retina", () => {
    expect(trackThumbnailPixelSizes).toEqual({
      xs: 64,
      sm: 80,
      md: 96,
      lg: 112,
    });
  });

  test("uses 2x playlist cover sizes for retina", () => {
    expect(playlistCoverPixelSizes).toEqual({
      sm: 128,
      md: 192,
      lg: 256,
    });
  });

  test("now-playing sheet cover uses a dedicated retina size", () => {
    expect(nowPlayingCoverPixelSize).toBe(320);
  });

  test("entity header cover is 2x the 192px display size", () => {
    expect(entityHeaderCoverPixelSize).toBe(384);
  });

  test("album card cover stays sharp in the widest artist grid", () => {
    expect(albumCardCoverPixelSize).toBe(512);
  });
});

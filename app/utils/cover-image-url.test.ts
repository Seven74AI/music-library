import { describe, expect, test } from "vitest";
import { coverImageUrl } from "./cover-image-url.ts";

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

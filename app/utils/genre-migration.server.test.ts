import { describe, expect, it } from "vitest";
import { normalizeGenreName, parseGenreString } from "./genre-migration.server.ts";

describe("Genre Migration Utility", () => {
  describe("normalizeGenreName", () => {
    it("should convert to lowercase", () => {
      expect(normalizeGenreName("Rock")).toBe("rock");
      expect(normalizeGenreName("JAZZ")).toBe("jazz");
      expect(normalizeGenreName("Hip Hop")).toBe("hip hop");
    });

    it("should trim whitespace", () => {
      expect(normalizeGenreName("  Rock  ")).toBe("rock");
      expect(normalizeGenreName("\tJazz\n")).toBe("jazz");
    });

    it("should remove special characters except hyphens", () => {
      expect(normalizeGenreName("Rock & Roll")).toBe("rock roll");
      expect(normalizeGenreName("Hip-Hop")).toBe("hip-hop");
      expect(normalizeGenreName("R&B")).toBe("rb");
    });

    it("should normalize multiple spaces", () => {
      expect(normalizeGenreName("Rock   And   Roll")).toBe("rock and roll");
    });

    it("should handle empty strings", () => {
      expect(normalizeGenreName("")).toBe("");
      expect(normalizeGenreName("   ")).toBe("");
    });
  });

  describe("parseGenreString", () => {
    it("should parse comma-separated genres", () => {
      expect(parseGenreString("Rock, Jazz, Blues")).toEqual(["Rock", "Jazz", "Blues"]);
    });

    it("should parse semicolon-separated genres", () => {
      expect(parseGenreString("Rock; Jazz; Blues")).toEqual(["Rock", "Jazz", "Blues"]);
    });

    it("should parse slash-separated genres", () => {
      expect(parseGenreString("Rock/Jazz/Blues")).toEqual(["Rock", "Jazz", "Blues"]);
    });

    it("should parse ampersand-separated genres", () => {
      expect(parseGenreString("Rock & Jazz & Blues")).toEqual(["Rock", "Jazz", "Blues"]);
    });

    it("should parse mixed delimiters", () => {
      expect(parseGenreString("Rock, Jazz/Blues; Metal")).toEqual([
        "Rock",
        "Jazz",
        "Blues",
        "Metal",
      ]);
    });

    it("should trim whitespace from each genre", () => {
      expect(parseGenreString("  Rock  ,  Jazz  ,  Blues  ")).toEqual(["Rock", "Jazz", "Blues"]);
    });

    it("should capitalize genres properly", () => {
      expect(parseGenreString("rock, JAZZ, hip hop")).toEqual(["Rock", "Jazz", "Hip Hop"]);
    });

    it("should remove duplicates (case-insensitive)", () => {
      expect(parseGenreString("Rock, rock, ROCK")).toEqual(["Rock"]);
      expect(parseGenreString("Jazz, jazz, Hip Hop, hip hop")).toEqual(["Jazz", "Hip Hop"]);
    });

    it("should handle empty strings", () => {
      expect(parseGenreString("")).toEqual([]);
      expect(parseGenreString("   ")).toEqual([]);
      expect(parseGenreString(null)).toEqual([]);
    });

    it("should filter out empty segments", () => {
      expect(parseGenreString("Rock,,Jazz,,Blues")).toEqual(["Rock", "Jazz", "Blues"]);
      expect(parseGenreString("Rock, , Jazz")).toEqual(["Rock", "Jazz"]);
    });

    it("should handle single genre", () => {
      expect(parseGenreString("Rock")).toEqual(["Rock"]);
    });

    it("should handle complex multi-word genres", () => {
      expect(parseGenreString("Progressive Rock, Alternative Metal, Hip Hop")).toEqual([
        "Progressive Rock",
        "Alternative Metal",
        "Hip Hop",
      ]);
    });

    it("should preserve hyphens in genre names", () => {
      expect(parseGenreString("Hip-Hop, Post-Rock, Neo-Soul")).toEqual([
        "Hip-hop",
        "Post-rock",
        "Neo-soul",
      ]);
    });
  });
});

import { describe, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { DUPLICATE_DETECTION_CLIENT_ERROR_MESSAGE } from "#app/utils/error-handlers.server.ts";

vi.mock("./duplicate-detection.server.ts", () => ({
  cacheArtistNormalizedNames: vi.fn().mockRejectedValue(new Error("SQLite disk I/O error")),
  cacheAlbumNormalizedNames: vi.fn(),
  findExactArtistDuplicates: vi.fn(),
  findFuzzyArtistDuplicates: vi.fn(),
  findExactAlbumDuplicates: vi.fn(),
  findFuzzyAlbumDuplicates: vi.fn(),
  saveDuplicateDetectionResults: vi.fn(),
}));

describe("runDuplicateDetectionJob", () => {
  test("returns a stable client message when the job fails", async () => {
    consoleError.mockImplementation(() => {});
    const { runDuplicateDetectionJob } = await import("./duplicate-detection-job.server.ts");
    const result = await runDuplicateDetectionJob();

    expect(result.success).toBe(false);
    expect(result.error).toBe(DUPLICATE_DETECTION_CLIENT_ERROR_MESSAGE);
    expect(result.error).not.toMatch(/SQLite/i);
  });
});

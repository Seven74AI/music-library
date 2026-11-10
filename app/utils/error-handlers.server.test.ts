import { describe, expect, test } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { ServiceNotFoundError } from "#app/features/service-playlist/playlist-utils.server";
import { YouTubeQuotaError, YouTubeValidationError } from "#app/utils/youtube-errors.ts";
import {
  DEFAULT_CLIENT_ERROR_MESSAGE,
  SERVICE_IMPORT_CLIENT_ERROR_MESSAGE,
  handleServiceError,
  toClientErrorMessage,
} from "./error-handlers.server";

describe("toClientErrorMessage", () => {
  test("maps unknown errors to the provided fallback", () => {
    expect(toClientErrorMessage(new Error("Invalid `prisma.track.create()` invocation"))).toBe(
      DEFAULT_CLIENT_ERROR_MESSAGE,
    );
    expect(
      toClientErrorMessage(new Error("db exploded"), SERVICE_IMPORT_CLIENT_ERROR_MESSAGE),
    ).toBe(SERVICE_IMPORT_CLIENT_ERROR_MESSAGE);
  });

  test("preserves known domain error messages", () => {
    expect(toClientErrorMessage(new YouTubeQuotaError())).toMatch(/quota/i);
    expect(toClientErrorMessage(new YouTubeValidationError("Title is required"))).toBe(
      "Title is required",
    );
    expect(toClientErrorMessage(new ServiceNotFoundError("youtube"))).toBe(
      "Service not found: youtube",
    );
  });
});

describe("handleServiceError", () => {
  test("does not return raw Prisma text to the client", () => {
    consoleError.mockImplementation(() => {});
    const result = handleServiceError(
      new Error("Unique constraint failed on the fields: (`id`)"),
      "importTrackDirectly",
      "YouTube",
      SERVICE_IMPORT_CLIENT_ERROR_MESSAGE,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe(SERVICE_IMPORT_CLIENT_ERROR_MESSAGE);
    expect(result.error).not.toMatch(/constraint/i);
  });
});

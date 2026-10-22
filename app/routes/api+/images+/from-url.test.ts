import { beforeEach, describe, expect, test, vi } from "vitest";
import { downloadExternalImage } from "#app/utils/cover-management.server.ts";
import { isValidCoverEntityId, verifyCoverEntity } from "#app/utils/cover-entity.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { action, clientAction } from "./from-url.tsx";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireCuratorRole: vi.fn(),
}));

vi.mock("#app/utils/cover-management.server.ts", () => ({
  downloadExternalImage: vi.fn(),
}));

vi.mock("#app/utils/cover-entity.server.ts", () => ({
  isValidCoverEntityId: vi.fn(),
  verifyCoverEntity: vi.fn(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/images/from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * react-router's data() is a DataWithResponseInit. Fetcher submissions only
 * receive data.error when the action returns that payload. Throwing it becomes
 * a route error and leaves the fetcher empty.
 */
async function returnedValidation(request: Request) {
  try {
    return await action({ request } as never);
  } catch (error) {
    const thrown = error as { data?: { error?: string }; init?: { status?: number } };
    throw new Error(
      `expected a returned 400 payload, but the action threw ${thrown.init?.status ?? "unknown"}: ${thrown.data?.error ?? String(error)}`,
      { cause: error },
    );
  }
}

describe("POST /api/images/from-url validation", () => {
  beforeEach(() => {
    vi.mocked(requireCuratorRole).mockResolvedValue("curator-1");
    vi.mocked(isValidCoverEntityId).mockReturnValue(true);
    vi.mocked(verifyCoverEntity).mockResolvedValue("artist-1");
  });

  test("returns a rejected image URL as action data instead of throwing", async () => {
    vi.mocked(downloadExternalImage).mockResolvedValue(null);

    const result = await returnedValidation(
      jsonRequest({
        url: "https://example.com/missing-cover.jpg",
        entityType: "artist",
        entityId: "artist-1",
      }),
    );

    expect(result).toMatchObject({
      data: {
        error: "Failed to download image from URL",
      },
      init: { status: 400 },
    });
  });

  test("returns 404 when the target entity does not exist", async () => {
    vi.mocked(verifyCoverEntity).mockResolvedValue(null);
    vi.mocked(downloadExternalImage).mockResolvedValue(null);

    const result = await returnedValidation(
      jsonRequest({
        url: "https://example.com/cover.jpg",
        entityType: "artist",
        entityId: "missing-artist",
      }),
    );

    expect(result).toMatchObject({
      data: { error: "artist not found" },
      init: { status: 404 },
    });
    expect(downloadExternalImage).not.toHaveBeenCalled();
  });

  test("returns 400 when entityId carries path segments", async () => {
    vi.mocked(isValidCoverEntityId).mockReturnValue(false);

    const result = await returnedValidation(
      jsonRequest({
        url: "https://example.com/cover.jpg",
        entityType: "artist",
        entityId: "../../etc/passwd",
      }),
    );

    expect(result).toMatchObject({
      data: { error: "Invalid entityId" },
      init: { status: 400 },
    });
    expect(verifyCoverEntity).not.toHaveBeenCalled();
  });
});

describe("clientAction for POST /api/images/from-url", () => {
  test("returns a successful server download", async () => {
    const payload = {
      success: true,
      image: { id: "img-2", objectKey: "images/artists/artist-1/cover.jpg" },
    };
    const serverAction = vi.fn().mockResolvedValue(payload);

    const result = await clientAction({
      request: jsonRequest({
        url: "https://example.com/cover.jpg",
        entityType: "artist",
        entityId: "artist-1",
      }),
      params: {},
      serverAction,
    } as never);

    expect(serverAction).toHaveBeenCalledOnce();
    expect(result).toEqual(payload);
  });

  test("rethrows server failures so real errors still hit the boundary", async () => {
    const serverAction = vi.fn().mockRejectedValue(new Error("database down"));

    await expect(
      clientAction({
        request: jsonRequest({ url: "https://example.com/cover.jpg" }),
        params: {},
        serverAction,
      } as never),
    ).rejects.toThrow("database down");
  });
});

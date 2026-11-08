import { beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_CURSOR_FORMAT_MESSAGE } from "#app/utils/search-validation.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { loader } from "./history.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/features/play-history/play-history.server.ts", () => ({
  getPlayHistory: vi.fn(),
  parseHistoryCursor: vi.fn((raw: string | null) => {
    if (raw === "bad") throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
    return null;
  }),
  PLAY_HISTORY_PAGE_SIZE: 50,
}));

describe("history API loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("returns 400 when play-history cursor is malformed", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/history?cursor=bad"),
      url: new URL("http://localhost/api/history?cursor=bad"),
    });

    expect(response.status).toBe(400);
  });
});

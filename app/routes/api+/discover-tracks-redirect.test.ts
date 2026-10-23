import { beforeEach, describe, expect, test, vi } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { loader } from "./discover-tracks.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

function makeRequest(url: string) {
  return { request: new Request(url), url: new URL(url) };
}

describe("discover-tracks API loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("redirects to login when unauthenticated", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Response(null, { status: 302 }));

    await expect(
      loader({
        ...makeRequest("http://localhost/api/discover-tracks"),
      } as never),
    ).rejects.toSatisfy((err: unknown) => err instanceof Response && err.status === 302);
  });
});

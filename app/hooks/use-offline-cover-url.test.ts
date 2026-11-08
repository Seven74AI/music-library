/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockResolveCachedCoverUrl = vi.fn();
const mockUseOnlineStatus = vi.fn();

vi.mock("#app/features/offline-storage/cover-cache.client.ts", () => ({
  resolveCachedCoverUrl: (...args: unknown[]) => mockResolveCachedCoverUrl(...args),
}));

vi.mock("#app/hooks/use-online-status.ts", () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

vi.mock("#app/utils/cover-image-url.ts", () => ({
  coverImageUrl: (key: string, size: number) => `https://cdn/${key}?s=${size}`,
}));

import { useOfflineCoverUrl } from "./use-offline-cover-url.ts";

describe("useOfflineCoverUrl", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("sets url to null when offline cover resolution rejects", async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    mockResolveCachedCoverUrl.mockRejectedValue(new Error("cache miss"));

    const { result } = renderHook(() => useOfflineCoverUrl("covers/abc", 128));

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(mockResolveCachedCoverUrl).toHaveBeenCalledWith("covers/abc");
  });

  test("uses resolved blob URL when offline cache succeeds", async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    mockResolveCachedCoverUrl.mockResolvedValue("blob:offline-cover");

    const { result } = renderHook(() => useOfflineCoverUrl("covers/abc", 128));

    await waitFor(() => {
      expect(result.current).toBe("blob:offline-cover");
    });
  });
});

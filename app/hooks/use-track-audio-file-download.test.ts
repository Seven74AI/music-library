/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockToast = vi.fn();
const mockTriggerBrowserDownload = vi.fn();

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock("#app/utils/download.ts", () => ({
  triggerBrowserDownload: (...args: unknown[]) => mockTriggerBrowserDownload(...args),
}));

import { useTrackAudioFileDownload } from "./use-track-audio-file-download.ts";

describe("useTrackAudioFileDownload", () => {
  beforeEach(() => {
    mockToast.mockReset();
    mockTriggerBrowserDownload.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ fileName: "Song.mp3" }),
      }),
    );
  });

  test("fetches download-url then triggers a browser file download", async () => {
    const { result } = renderHook(() =>
      useTrackAudioFileDownload({ id: "track-1", title: "Song" }),
    );

    await act(async () => {
      await result.current.downloadAudioFile();
    });

    expect(fetch).toHaveBeenCalledWith("/resources/audio/track-1/download-url");
    expect(mockTriggerBrowserDownload).toHaveBeenCalledWith(
      "/resources/audio/track-1?stream=1",
      "Song.mp3",
    );
    expect(result.current.label).toBe("Download");
  });

  test("toasts on failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const { result } = renderHook(() =>
      useTrackAudioFileDownload({ id: "track-1", title: "Song" }),
    );

    await act(async () => {
      await result.current.downloadAudioFile();
    });

    expect(mockTriggerBrowserDownload).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Download failed", variant: "destructive" }),
    );
    consoleError.mockRestore();
  });
});

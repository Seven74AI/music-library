import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  addTrackToUserLibrary,
  addTracksToUserLibrary,
  removeTrackFromUserLibrary,
} from "#app/features/user-library/user-library.server";
import { requireUserId } from "#app/utils/auth.server.ts";
import { action } from "./track-library.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/features/user-library/user-library.server", () => ({
  addTrackToUserLibrary: vi.fn(),
  addTracksToUserLibrary: vi.fn(),
  removeTrackFromUserLibrary: vi.fn(),
}));

vi.mock("#app/utils/toast.server.ts", () => ({
  createToastHeaders: vi.fn().mockResolvedValue({}),
}));

function makeRequest(formData: FormData) {
  return new Request("http://localhost/resources/track-library", {
    method: "POST",
    body: formData,
  });
}

describe("track-library action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("adds a single track via trackId", async () => {
    vi.mocked(addTrackToUserLibrary).mockResolvedValue({
      success: true,
      message: "Track added to library",
    });

    const formData = new FormData();
    formData.append("trackId", "track-1");
    formData.append("action", "add");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(addTrackToUserLibrary).toHaveBeenCalledWith("track-1", "user-1");
    expect(addTracksToUserLibrary).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: { status: "success" },
    });
  });

  test("adds multiple tracks via trackIds in one call", async () => {
    vi.mocked(addTracksToUserLibrary).mockResolvedValue({
      success: true,
      message: "3 tracks added to library",
      addedCount: 3,
    });

    const formData = new FormData();
    formData.append("action", "add");
    formData.append("trackIds", "track-1");
    formData.append("trackIds", "track-2");
    formData.append("trackIds", "track-3");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(addTracksToUserLibrary).toHaveBeenCalledWith(
      ["track-1", "track-2", "track-3"],
      "user-1",
    );
    expect(addTrackToUserLibrary).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: { status: "success", addedCount: 3 },
    });
  });
});

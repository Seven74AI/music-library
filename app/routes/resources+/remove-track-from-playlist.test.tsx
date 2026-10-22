import { describe, expect, test, vi, beforeEach } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { removeTrackFromUserPlaylist } from "#app/utils/user-playlist.server.ts";
import { action } from "./remove-track-from-playlist.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/user-playlist.server.ts", () => ({
  removeTrackFromUserPlaylist: vi.fn(),
}));

vi.mock("#app/utils/toast.server.ts", () => ({
  createToastHeaders: vi.fn().mockResolvedValue({}),
}));

function makeRequest(formData: FormData) {
  return new Request("http://localhost/resources/remove-track-from-playlist", {
    method: "POST",
    body: formData,
  });
}

describe("remove-track-from-playlist action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("returns 400 for invalid form data", async () => {
    const fd = new FormData();
    fd.append("trackId", "track-1");

    const response = await action({ request: makeRequest(fd) } as never);

    expect(response).toMatchObject({
      data: { status: "error", message: "Invalid form data" },
      init: { status: 400 },
    });
  });

  test("returns 404 when playlist is not found", async () => {
    vi.mocked(removeTrackFromUserPlaylist).mockResolvedValue({ status: "not_found" });

    const fd = new FormData();
    fd.append("trackId", "track-1");
    fd.append("playlistId", "playlist-1");

    const response = await action({ request: makeRequest(fd) } as never);

    expect(response).toMatchObject({
      data: { status: "error", message: "Playlist not found" },
      init: { status: 404 },
    });
  });

  test("returns error when track is not in playlist", async () => {
    vi.mocked(removeTrackFromUserPlaylist).mockResolvedValue({
      status: "not_in_playlist",
      playlistTitle: "Favorites",
    });

    const fd = new FormData();
    fd.append("trackId", "track-1");
    fd.append("playlistId", "playlist-1");

    const response = await action({ request: makeRequest(fd) } as never);

    expect(response).toMatchObject({
      data: {
        status: "error",
        message: 'Track is not in "Favorites"',
      },
    });
  });

  test("returns success when track is removed", async () => {
    vi.mocked(removeTrackFromUserPlaylist).mockResolvedValue({
      status: "success",
      playlistTitle: "Favorites",
      removedCount: 1,
    });

    const fd = new FormData();
    fd.append("trackId", "track-1");
    fd.append("playlistId", "playlist-1");

    const response = await action({ request: makeRequest(fd) } as never);

    expect(removeTrackFromUserPlaylist).toHaveBeenCalledWith({
      userId: "user-1",
      playlistId: "playlist-1",
      trackId: "track-1",
    });
    expect(response).toMatchObject({
      data: {
        status: "success",
        message: 'Removed from "Favorites"',
        playlistId: "playlist-1",
        removedCount: 1,
      },
    });
  });
});

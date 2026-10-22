import { data } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { createToastHeaders } from "#app/utils/toast.server.ts";
import { removeTrackFromUserPlaylist } from "#app/utils/user-playlist.server.ts";
import { type Route } from "./+types/remove-track-from-playlist";

/**
 * Server action for removing a track from a user playlist.
 * Used when AddToPlaylistMenu detects a duplicate and the user chooses to remove it.
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();

  const trackId = formData.get("trackId");
  const playlistId = formData.get("playlistId");

  if (typeof trackId !== "string" || typeof playlistId !== "string") {
    return data(
      { status: "error", message: "Invalid form data" },
      {
        status: 400,
        headers: await createToastHeaders({
          title: "Error",
          description: "Invalid form data provided",
          type: "error",
        }),
      },
    );
  }

  try {
    const result = await removeTrackFromUserPlaylist({
      userId,
      playlistId,
      trackId,
    });

    if (result.status === "not_found") {
      return data(
        { status: "error", message: "Playlist not found" },
        {
          status: 404,
          headers: await createToastHeaders({
            title: "Error",
            description: "Playlist not found",
            type: "error",
          }),
        },
      );
    }

    if (result.status === "not_in_playlist") {
      return data(
        {
          status: "error",
          message: `Track is not in "${result.playlistTitle}"`,
        },
        {
          headers: await createToastHeaders({
            title: "Not Found",
            description: `Track is not in "${result.playlistTitle}"`,
            type: "error",
          }),
        },
      );
    }

    return data(
      {
        status: "success",
        message: `Removed from "${result.playlistTitle}"`,
        playlistId,
        removedCount: result.removedCount,
      },
      {
        headers: await createToastHeaders({
          title: "Success",
          description: `Track removed from "${result.playlistTitle}"`,
          type: "success",
        }),
      },
    );
  } catch (error) {
    console.error("Error removing track from playlist:", error);
    return data(
      { status: "error", message: "Internal server error" },
      {
        status: 500,
        headers: await createToastHeaders({
          title: "Error",
          description: "Failed to remove track from playlist",
          type: "error",
        }),
      },
    );
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

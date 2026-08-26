import { data } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { createToastHeaders } from "#app/utils/toast.server.ts";
import { createUserPlaylistWithTrack } from "#app/utils/user-playlist.server.ts";
import { type Route } from "./+types/create-playlist-with-track";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const title = formData.get("title");
  const trackId = formData.get("trackId");

  if (typeof title !== "string" || typeof trackId !== "string") {
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
    const result = await createUserPlaylistWithTrack({
      userId,
      title,
      trackId,
    });

    if (result.status === "invalid_title") {
      return data(
        { status: "invalid_title", message: "Playlist name is required" },
        {
          headers: await createToastHeaders({
            title: "Error",
            description: "Playlist name is required",
            type: "error",
          }),
        },
      );
    }

    if (result.status === "duplicate_title") {
      return data(
        {
          status: "duplicate_title",
          message: `You already have a playlist named "${result.existingTitle}"`,
          existingTitle: result.existingTitle,
        },
        {
          headers: await createToastHeaders({
            title: "Duplicate playlist",
            description: `You already have a playlist named "${result.existingTitle}"`,
            type: "error",
          }),
        },
      );
    }

    return data(
      {
        status: "success",
        message: `Created "${result.playlist.title}" and added track`,
        playlist: result.playlist,
      },
      {
        headers: await createToastHeaders({
          title: "Success",
          description: `Created "${result.playlist.title}" and added track`,
          type: "success",
        }),
      },
    );
  } catch (error) {
    console.error("Error creating playlist with track:", error);
    return data(
      { status: "error", message: "Internal server error" },
      {
        status: 500,
        headers: await createToastHeaders({
          title: "Error",
          description: "Failed to create playlist",
          type: "error",
        }),
      },
    );
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

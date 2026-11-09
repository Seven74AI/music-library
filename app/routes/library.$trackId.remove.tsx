import { data } from "react-router";
import { removeTrackFromUserLibrary } from "#app/features/user-library/user-library.server";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { createToastHeaders, redirectWithToast } from "#app/utils/toast.server.ts";
import { type Route } from "./+types/library.$trackId.remove.ts";

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const trackId = params.trackId;

  if (!trackId) {
    return redirectWithToast("/library", {
      title: "Error",
      description: "No track ID provided.",
      type: "error",
    });
  }

  try {
    // Check if the user has this track in their library
    const userTrack = await prisma.userTrack.findUnique({
      where: {
        userId_trackId: {
          userId: userId,
          trackId: trackId,
        },
      },
      include: {
        track: {
          select: {
            title: true,
            artist: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!userTrack) {
      return redirectWithToast("/library", {
        title: "Track Not Found",
        description: "This track is not in your library.",
        type: "error",
      });
    }

    const result = await removeTrackFromUserLibrary(trackId, userId);
    if (!result.success) {
      return data(
        { status: "error", message: result.message },
        {
          status: 404,
          headers: await createToastHeaders({
            title: "Track Not Found",
            description: result.message,
            type: "error",
          }),
        },
      );
    }

    const artistName = userTrack.track.artist?.name || "Unknown Artist";
    return data(
      { status: "success", message: result.message },
      {
        headers: await createToastHeaders({
          title: "Track Removed",
          description: `"${userTrack.track.title}" by ${artistName} has been removed from your library.`,
          type: "success",
        }),
      },
    );
  } catch (error) {
    console.error("Error removing track:", error);
    return redirectWithToast("/library", {
      title: "Error",
      description: "Failed to remove track. Please try again.",
      type: "error",
    });
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

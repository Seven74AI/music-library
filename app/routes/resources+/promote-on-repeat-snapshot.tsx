import { data } from "react-router";
import { requireUserId } from "#app/utils/auth.server.ts";
import { promoteOnRepeatSnapshot } from "#app/features/on-repeat-snapshots/promote.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { createToastHeaders } from "#app/utils/toast.server.ts";
import { type Route } from "./+types/promote-on-repeat-snapshot";

/**
 * POST /resources/promote-on-repeat-snapshot
 *
 * Body: snapshotId, action ("create" | "add"), title | targetPlaylistId
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();

  const snapshotId = formData.get("snapshotId");
  const actionType = formData.get("action");

  if (typeof snapshotId !== "string" || !snapshotId) {
    return data(
      { status: "error", message: "Invalid snapshot ID" },
      {
        status: 400,
        headers: await createToastHeaders({
          title: "Error",
          description: "Invalid snapshot ID",
          type: "error",
        }),
      },
    );
  }

  if (actionType === "create") {
    const title = formData.get("title");
    if (typeof title !== "string") {
      return data(
        { status: "error", message: "Playlist name is required" },
        {
          status: 400,
          headers: await createToastHeaders({
            title: "Error",
            description: "Playlist name is required",
            type: "error",
          }),
        },
      );
    }

    const result = await promoteOnRepeatSnapshot({
      userId,
      snapshotId,
      mode: "create",
      title,
    });

    if (result.status === "not_found") {
      return data(
        { status: "error", message: "Snapshot not found" },
        {
          status: 404,
          headers: await createToastHeaders({
            title: "Error",
            description: "Snapshot not found",
            type: "error",
          }),
        },
      );
    }
    if (result.status === "invalid_title") {
      return data(
        { status: "error", message: "Playlist name is required" },
        {
          status: 400,
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
          status: 409,
          headers: await createToastHeaders({
            title: "Duplicate Playlist",
            description: `You already have a playlist named "${result.existingTitle}"`,
            type: "error",
          }),
        },
      );
    }

    if (result.status !== "success") {
      return data(
        { status: "error", message: "Failed to promote snapshot" },
        {
          status: 400,
          headers: await createToastHeaders({
            title: "Error",
            description: "Failed to promote snapshot",
            type: "error",
          }),
        },
      );
    }

    return data(
      {
        status: "success",
        message: `Created "${result.playlist.title}" with ${result.addedCount} tracks`,
        addedCount: result.addedCount,
        skippedCount: result.skippedCount,
        playlist: result.playlist,
      },
      {
        headers: await createToastHeaders({
          title: "Playlist Created",
          description: `"${result.playlist.title}" created with ${result.addedCount} tracks.`,
          type: "success",
        }),
      },
    );
  }

  if (actionType === "add") {
    const targetPlaylistId = formData.get("targetPlaylistId");
    if (typeof targetPlaylistId !== "string" || !targetPlaylistId) {
      return data(
        { status: "error", message: "Target playlist not specified" },
        {
          status: 400,
          headers: await createToastHeaders({
            title: "Error",
            description: "Target playlist not specified",
            type: "error",
          }),
        },
      );
    }

    const result = await promoteOnRepeatSnapshot({
      userId,
      snapshotId,
      mode: "add",
      targetPlaylistId,
    });

    if (result.status === "not_found") {
      return data(
        { status: "error", message: "Snapshot not found" },
        {
          status: 404,
          headers: await createToastHeaders({
            title: "Error",
            description: "Snapshot not found",
            type: "error",
          }),
        },
      );
    }
    if (result.status === "target_not_found") {
      return data(
        { status: "error", message: "Target playlist not found" },
        {
          status: 404,
          headers: await createToastHeaders({
            title: "Error",
            description: "Target playlist not found",
            type: "error",
          }),
        },
      );
    }
    if (result.status !== "success") {
      return data(
        { status: "error", message: "Failed to promote snapshot" },
        {
          status: 400,
          headers: await createToastHeaders({
            title: "Error",
            description: "Failed to promote snapshot",
            type: "error",
          }),
        },
      );
    }

    return data(
      {
        status: "success",
        message: `Added ${result.addedCount} tracks to "${result.playlist.title}"`,
        addedCount: result.addedCount,
        skippedCount: result.skippedCount,
        playlist: result.playlist,
      },
      {
        headers: await createToastHeaders({
          title: "Tracks Added",
          description:
            result.skippedCount > 0
              ? `Added ${result.addedCount}, skipped ${result.skippedCount} duplicates in "${result.playlist.title}".`
              : `Added ${result.addedCount} tracks to "${result.playlist.title}".`,
          type: "success",
        }),
      },
    );
  }

  return data(
    { status: "error", message: "Invalid action" },
    {
      status: 400,
      headers: await createToastHeaders({
        title: "Error",
        description: "Invalid action",
        type: "error",
      }),
    },
  );
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

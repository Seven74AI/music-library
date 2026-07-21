import { data, redirect, Form, useActionData, useNavigation, Link } from "react-router";
import { type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { Textarea } from "#app/components/ui/textarea.tsx";
import { requireUserId } from "#app/utils/auth.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { createToastHeaders } from "#app/utils/toast.server.ts";
import { createUserPlaylist } from "#app/utils/user-playlist.server.ts";
import { type Route } from "./+types/playlists.new.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: <Icon name="plus">New Playlist</Icon>,
};

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const title = formData.get("title");
  const description = formData.get("description");

  if (typeof title !== "string" || !title.trim()) {
    return data({ error: "Title is required" }, { status: 400 });
  }

  if (typeof description !== "string") {
    return data({ error: "Description must be a string" }, { status: 400 });
  }

  const result = await createUserPlaylist({
    userId,
    title,
    description,
  });

  if (result.status === "duplicate_title") {
    return data(
      { error: `You already have a playlist named "${result.existingTitle}"` },
      {
        status: 409,
        headers: await createToastHeaders({
          title: "Duplicate playlist",
          description: `You already have a playlist named "${result.existingTitle}"`,
          type: "error",
        }),
      },
    );
  }

  if (result.status === "invalid_title") {
    return data({ error: "Title is required" }, { status: 400 });
  }

  return redirect(`/playlists/${result.playlist.id}`);
}

export default function PlaylistsNewRoute({ loaderData: _loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create New Playlist</h1>
        <p className="text-muted-foreground">Organize your music into custom playlists.</p>
      </div>

      <Form method="post" className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            type="text"
            placeholder="Enter playlist title"
            required
            defaultValue=""
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="Enter playlist description (optional)"
            rows={3}
          />
        </div>

        {actionData?.error && <div className="text-sm text-destructive">{actionData.error}</div>}

        <div className="flex gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Playlist"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/playlists">Cancel</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

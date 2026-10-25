/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { createUserPlaylist } from "#app/utils/user-playlist.server.ts";
import PlaylistsNewRoute, { action } from "./playlists.new.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/user-playlist.server.ts", () => ({
  createUserPlaylist: vi.fn(),
}));

vi.mock("#app/utils/toast.server.ts", () => ({
  createToastHeaders: vi.fn().mockResolvedValue({}),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    redirect: vi.fn(
      (url: string) =>
        new Response(null, {
          status: 302,
          headers: { Location: url },
        }),
    ),
  };
});

describe("new playlist form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("keeps the typed title after a case-insensitive duplicate", async () => {
    vi.mocked(createUserPlaylist).mockResolvedValue({
      status: "duplicate_title",
      existingTitle: "Road Trip",
    });

    const App = createRoutesStub([
      {
        path: "/playlists/new",
        Component: PlaylistsNewRoute,
        action,
      },
    ]);

    const user = userEvent.setup();
    render(<App initialEntries={["/playlists/new"]} />);

    const titleInput = await screen.findByRole("textbox", { name: "Title" });
    await user.type(titleInput, "road trip");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Summer mix");
    await user.click(screen.getByRole("button", { name: "Create Playlist" }));

    expect(
      await screen.findByText('You already have a playlist named "Road Trip"'),
    ).toBeInTheDocument();
    expect(titleInput).toHaveValue("road trip");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Summer mix");

    // React resets the form to each field's defaultValue when the action
    // returns the 409 result. The typed title has to survive that reset.
    titleInput.closest("form")?.reset();

    expect(titleInput).toHaveValue("road trip");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Summer mix");

    await user.clear(titleInput);
    await user.type(titleInput, "Road Trip Mix");
    expect(titleInput).toHaveValue("Road Trip Mix");

    expect(createUserPlaylist).toHaveBeenCalledWith({
      userId: "user-1",
      title: "road trip",
      description: "Summer mix",
    });
  });
});

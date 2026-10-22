/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { AddToPlaylistMenu } from "./add-to-playlist-menu";

const mockSubmit = vi.fn();
const mockRevalidate = vi.fn();

const mockFetcher = {
  state: "idle" as const,
  data: undefined as { status: string; message?: string; playlistId?: string } | undefined,
  submit: mockSubmit,
};

const mockCreateFetcher = {
  state: "idle" as const,
  data: undefined as
    | {
        status: string;
        message?: string;
        existingTitle?: string;
        playlist?: {
          id: string;
          title: string;
          description: string | null;
          _count: { tracks: number };
        };
      }
    | undefined,
  submit: vi.fn(),
};

const mockPlaylistsFetcher = {
  state: "idle" as "idle" | "submitting" | "loading",
  data: undefined as
    | {
        playlists: Array<{
          id: string;
          title: string;
          description: string | null;
          _count: { tracks: number };
        }>;
      }
    | undefined,
  load: vi.fn(),
};

let fetcherIndex = 0;
let useFetcherCallCount = 0;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => {
      useFetcherCallCount += 1;
      const idx = fetcherIndex % 3;
      fetcherIndex += 1;
      if (idx === 0) return mockFetcher;
      if (idx === 1) return mockCreateFetcher;
      return mockPlaylistsFetcher;
    },
    useRevalidator: () => ({ revalidate: mockRevalidate }),
  };
});

beforeEach(() => {
  useFetcherCallCount = 0;
  fetcherIndex = 0;
  mockFetcher.state = "idle";
  mockFetcher.data = undefined;
  mockCreateFetcher.state = "idle";
  mockCreateFetcher.data = undefined;
  mockPlaylistsFetcher.state = "idle";
  mockPlaylistsFetcher.data = undefined;
  mockPlaylistsFetcher.load.mockReset();
  mockSubmit.mockReset();
  mockRevalidate.mockReset();
});

function renderMenu(
  playlists?: Array<{
    id: string;
    title: string;
    description: string | null;
    _count: { tracks: number };
  }>,
  options?: { constrainHeight?: boolean },
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AddToPlaylistMenu
            trackId="track-1"
            trackTitle="Test Song"
            playlists={playlists}
            constrainHeight={options?.constrainHeight}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

test("shows new playlist button when user has no playlists", () => {
  renderMenu([]);

  expect(screen.getByText("No playlists yet")).toBeDefined();
  expect(screen.getByRole("button", { name: "New playlist" })).toBeDefined();
});

test("expands inline create form and submits playlist name", async () => {
  const user = userEvent.setup();
  renderMenu([]);

  await user.click(screen.getByRole("button", { name: "New playlist" }));
  const input = screen.getByPlaceholderText("Playlist name");
  await user.type(input, "Road Trip");
  await user.click(screen.getByRole("button", { name: "Create playlist" }));

  expect(mockCreateFetcher.submit).toHaveBeenCalled();
});

test("dropdown layout keeps a fixed playlist list ahead of New playlist", () => {
  const { container } = renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  const list = screen.getByTestId("add-to-playlist-list");
  const menu = screen.getByRole("dialog", { name: "Add to playlist" });
  expect(list.className).toContain("h-64");
  expect(list.className).not.toContain("overflow-y-auto");
  expect(menu.className).not.toContain("flex-col");
  expect(container.querySelector("[data-radix-scroll-area-viewport]")).not.toBeNull();
  expect(
    list.compareDocumentPosition(screen.getByRole("button", { name: "New playlist" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("constrained sheet layout shrinks the list and keeps New playlist after it", async () => {
  const user = userEvent.setup();
  renderMenu(
    [
      {
        id: "playlist-1",
        title: "Favorites",
        description: null,
        _count: { tracks: 3 },
      },
    ],
    { constrainHeight: true },
  );

  const list = screen.getByTestId("add-to-playlist-list");
  const menu = screen.getByRole("dialog", { name: "Add to playlist" });
  const newPlaylist = screen.getByRole("button", { name: "New playlist" });
  expect(menu.className).toContain("flex");
  expect(menu.className).toContain("flex-col");
  expect(menu.className).toContain("min-h-0");
  expect(list.className).toContain("h-64");
  expect(list.className).toContain("min-h-0");
  expect(list.className).toContain("shrink");
  expect(list.className).toContain("overflow-y-auto");
  expect(menu.contains(newPlaylist)).toBe(true);
  expect(list.compareDocumentPosition(newPlaylist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(newPlaylist);
  expect(screen.getByPlaceholderText("Playlist name")).toBeDefined();
});

test("shows new playlist button alongside existing playlists", () => {
  renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  expect(screen.getByText("Favorites")).toBeDefined();
  expect(screen.getByRole("button", { name: "New playlist" })).toBeDefined();
});

test("shows newly created playlist only once after inline create succeeds", () => {
  mockCreateFetcher.data = {
    status: "success",
    playlist: {
      id: "playlist-new",
      title: "test5",
      description: null,
      _count: { tracks: 1 },
    },
  };

  renderMenu([
    {
      id: "playlist-1",
      title: "test4",
      description: null,
      _count: { tracks: 1 },
    },
  ]);

  expect(screen.getAllByText("test5")).toHaveLength(1);
});

test("self-fetches playlists when playlists prop is omitted", () => {
  renderMenu(undefined);

  expect(mockPlaylistsFetcher.load).toHaveBeenCalledWith("/resources/playlists");
});

test("does not fetch playlists when playlists prop is provided", () => {
  renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  expect(mockPlaylistsFetcher.load).not.toHaveBeenCalled();
});

test("search input does not auto-focus on render", () => {
  renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  const input = screen.getByPlaceholderText("Search playlists...");
  expect(document.activeElement).not.toBe(input);
});

test("renders fetched playlists from self-fetch", () => {
  mockPlaylistsFetcher.data = {
    playlists: [
      {
        id: "pl-fetched",
        title: "Fetched Playlist",
        description: "From server",
        _count: { tracks: 7 },
      },
    ],
  };

  renderMenu(undefined);

  expect(screen.getByText("Fetched Playlist")).toBeDefined();
  expect(screen.getByText("7 tracks")).toBeDefined();
});

test("shows skeleton rows while the self-fetch is loading", () => {
  mockPlaylistsFetcher.state = "loading";
  mockPlaylistsFetcher.data = undefined;

  renderMenu(undefined);

  expect(screen.getByRole("status", { name: "Loading playlists" })).toBeDefined();
  expect(screen.queryByText("No playlists yet")).toBeNull();
});

test("shows empty state only after the self-fetch settles with no results", () => {
  mockPlaylistsFetcher.state = "idle";
  mockPlaylistsFetcher.data = { playlists: [] };

  renderMenu(undefined);

  expect(screen.getByText("No playlists yet")).toBeDefined();
  expect(screen.queryByRole("status", { name: "Loading playlists" })).toBeNull();
});

test("duplicate dialog offers remove from playlist alongside add duplicate", () => {
  mockFetcher.data = {
    status: "duplicate",
    playlistId: "playlist-1",
  };

  renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  expect(screen.getByRole("heading", { name: "Track already in playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Remove from Playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Add Duplicate" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
});

test("remove from playlist submits to remove-track-from-playlist", async () => {
  const user = userEvent.setup();
  mockFetcher.data = {
    status: "duplicate",
    playlistId: "playlist-1",
  };

  renderMenu([
    {
      id: "playlist-1",
      title: "Favorites",
      description: null,
      _count: { tracks: 3 },
    },
  ]);

  await user.click(screen.getByRole("button", { name: "Remove from Playlist" }));

  expect(mockSubmit).toHaveBeenCalledWith(
    {
      trackId: "track-1",
      playlistId: "playlist-1",
    },
    {
      method: "POST",
      action: "/resources/remove-track-from-playlist",
    },
  );
});

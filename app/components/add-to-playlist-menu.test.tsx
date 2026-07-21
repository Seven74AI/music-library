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
  state: "idle" as const,
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
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AddToPlaylistMenu trackId="track-1" trackTitle="Test Song" playlists={playlists} />
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

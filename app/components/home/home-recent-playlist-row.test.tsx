/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, expect, test, vi } from "vitest";
import { type HomeRecentPlaylist } from "#app/utils/home.server.ts";
import { HomeRecentPlaylistRow } from "./home-recent-playlist-row.tsx";

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    playUserPlaylist: vi.fn(),
  }),
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const makePlaylist = (overrides: Partial<HomeRecentPlaylist> = {}): HomeRecentPlaylist => ({
  id: "playlist-1",
  title: "Chill Vibes",
  description: "Late night listening",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-06-01"),
  trackCount: 1,
  totalDuration: 245,
  tracks: [
    {
      id: "pt-1",
      track: {
        id: "track-1",
        title: "Midnight City",
        artist: { id: "artist-1", name: "M83" },
        duration: 245,
        coverImage: { objectKey: "covers/midnight-city.jpg" },
      },
    },
  ],
  ...overrides,
});

function renderRow(recentPlaylists: HomeRecentPlaylist[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <HomeRecentPlaylistRow recentPlaylists={recentPlaylists} />,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("shows empty state when there are no playlists", () => {
  renderRow([]);

  expect(screen.getByText("No playlists yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /create your first playlist/i })).toHaveAttribute(
    "href",
    "/playlists/new",
  );
});

test("renders playlist cards with covers and links", () => {
  renderRow([
    makePlaylist(),
    makePlaylist({
      id: "playlist-2",
      title: "Focus Flow",
      description: null,
    }),
  ]);

  expect(screen.getByText("Chill Vibes")).toBeInTheDocument();
  expect(screen.getByText("Focus Flow")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /chill vibes/i })).toHaveAttribute(
    "href",
    "/playlists/playlist-1",
  );
  expect(screen.getByRole("link", { name: /focus flow/i })).toHaveAttribute(
    "href",
    "/playlists/playlist-2",
  );
});

test("shows full track count even when only preview tracks are loaded", () => {
  const updatedAt = new Date("2024-06-01");
  renderRow([
    makePlaylist({
      trackCount: 12,
      updatedAt,
      tracks: [
        {
          id: "pt-1",
          track: {
            id: "track-1",
            title: "Midnight City",
            artist: { id: "artist-1", name: "M83" },
            duration: 245,
            coverImage: { objectKey: "covers/midnight-city.jpg" },
          },
        },
      ],
    }),
  ]);

  expect(
    screen.getByText(`12 tracks · Updated ${updatedAt.toLocaleDateString()}`),
  ).toBeInTheDocument();
});

test("renders slim grid tiles instead of duration stats", () => {
  renderRow([
    makePlaylist({
      trackCount: 12,
      totalDuration: 3600,
    }),
  ]);

  expect(screen.getByTestId("playlist-card")).toHaveAttribute("data-variant", "grid");
  expect(screen.queryByText("1:00:00")).not.toBeInTheDocument();
  expect(screen.queryByText("4:05")).not.toBeInTheDocument();
});

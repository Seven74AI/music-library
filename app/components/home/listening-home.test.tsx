/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { type HomeListeningData } from "#app/utils/home.server.ts";
import { ListeningHome } from "./listening-home.tsx";

vi.mock("#app/hooks/use-pwa-install.ts", () => ({
  usePwaInstall: () => ({
    visible: false,
    dismiss: vi.fn(),
    install: vi.fn(),
    isIos: false,
    isAndroid: false,
    canInstallNatively: false,
  }),
}));

vi.mock("#app/components/home/home-recent-track-row.tsx", () => ({
  HomeRecentTrackRow: () => <div>Recent tracks row</div>,
}));

vi.mock("#app/components/home/home-recent-playlist-row.tsx", () => ({
  HomeRecentPlaylistRow: () => <div>Recent playlists row</div>,
}));

vi.mock("#app/components/home/heavy-rotation-strip.tsx", () => ({
  HeavyRotationStrip: ({ title, tracks }: { title: string; tracks: Array<unknown> }) =>
    tracks.length === 0 ? null : <div>{title}</div>,
}));

vi.mock("#app/components/home/recently-played-strip.tsx", () => ({
  RecentlyPlayedStrip: ({ tracks }: { tracks: Array<{ track: { title: string } }> }) =>
    tracks.length === 0 ? null : (
      <section>
        <h2>Recently played</h2>
        <div>{tracks.map((t) => t.track.title).join(", ")}</div>
      </section>
    ),
}));

const baseListeningData: HomeListeningData = {
  mode: "listening",
  totalTracks: 4,
  playableTracks: 2,
  archivingCount: 2,
  stats: {
    totalTracks: 4,
    totalPlaylists: 1,
  },
  recentTracks: [],
  recentlyPlayed: [],
  heavyRotationMonth: [],
  heavyRotationEver: [],
  recentPlaylists: [],
  onRepeatSnapshots: [],
  weeklyWrap: null,
  youtubeData: Promise.resolve({
    hasYouTubeConnection: true,
    youtubeStats: {
      totalPlaylists: 1,
      lastSync: new Date("2024-01-01"),
    },
    youtubePlaylists: [],
  }),
};

function renderListening(props: Partial<HomeListeningData> & { showArchivingBanner: boolean }) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <Suspense fallback={<div>Loading</div>}>
            <ListeningHome {...baseListeningData} {...props} />
          </Suspense>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("does not show Home title, pick-up copy, or Play library button", async () => {
  renderListening({ showArchivingBanner: false });

  expect(await screen.findByRole("heading", { name: /recently added/i })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /^home$/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/pick up where you left off/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/tracks are still archiving/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /play library/i })).not.toBeInTheDocument();
});

test("shows Explore Music section with link to discover", async () => {
  renderListening({ showArchivingBanner: false });

  const exploreHeading = await screen.findByRole("heading", { name: /explore music/i });
  expect(exploreHeading).toBeInTheDocument();

  const discoverLink = screen.getByRole("link", { name: /browse discover/i });
  expect(discoverLink).toHaveAttribute("href", "/discover");
});

test("shows archiving banner in gray mode", async () => {
  renderListening({
    showArchivingBanner: true,
    mode: "gray",
    totalTracks: 3,
    playableTracks: 0,
    archivingCount: 3,
  });

  const banner = await screen.findByRole("status");
  expect(banner).toHaveTextContent("3 tracks in your library");
  expect(banner).toHaveTextContent("0 ready to play");
  expect(banner).toHaveTextContent("3 archiving");
});

test("hides Heavy Rotation strips when both windows are empty", async () => {
  renderListening({ showArchivingBanner: false });

  await screen.findByRole("heading", { name: /recently added/i });
  expect(screen.queryByText(/heavy rotation · this month/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/heavy rotation · ever/i)).not.toBeInTheDocument();
});

test("shows Heavy Rotation strips independently when non-empty", async () => {
  const track = {
    completedCount: 2,
    track: {
      id: "t1",
      title: "Song",
      duration: 100,
      serviceUrl: null,
      artist: { id: "a1", name: "Artist" },
      coverImage: null,
      service: null,
      audioFiles: [],
    },
  };

  renderListening({
    showArchivingBanner: false,
    heavyRotationMonth: [track],
    heavyRotationEver: [],
  });

  expect(await screen.findByText(/heavy rotation · this month/i)).toBeInTheDocument();
  expect(screen.queryByText(/heavy rotation · ever/i)).not.toBeInTheDocument();
});

test("shows weekly wrap when loader provides summary data", async () => {
  renderListening({
    showArchivingBanner: false,
    weeklyWrap: { finishes: 7, uniqueTracks: 4, dayStreak: 3 },
  });

  expect(await screen.findByTestId("weekly-wrap")).toHaveTextContent(/this week/i);
  expect(screen.getByTestId("weekly-wrap")).toHaveTextContent(/7 finishes/i);
  expect(screen.getByTestId("weekly-wrap")).toHaveTextContent(/4 tracks/i);
  expect(screen.getByTestId("weekly-wrap")).toHaveTextContent(/3-day streak/i);
});

test("omits weekly wrap when summary is null", async () => {
  renderListening({ showArchivingBanner: false, weeklyWrap: null });

  await screen.findByRole("heading", { name: /recently added/i });
  expect(screen.queryByTestId("weekly-wrap")).not.toBeInTheDocument();
});

test("omits Recently played strip when recentlyPlayed is empty", async () => {
  renderListening({ showArchivingBanner: false, recentlyPlayed: [] });

  await screen.findByRole("heading", { name: /recently added/i });
  expect(screen.queryByRole("heading", { name: /recently played/i })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /recent playlists/i })).toBeInTheDocument();
});

test("places Recently played strip above recent playlists when non-empty", async () => {
  renderListening({
    showArchivingBanner: false,
    recentlyPlayed: [
      {
        playedAt: new Date("2026-09-23T12:00:00.000Z"),
        track: {
          id: "track-1",
          title: "Finished Song",
          duration: 180,
          serviceUrl: null,
          artist: { id: "a1", name: "Artist" },
          coverImage: null,
          service: null,
          audioFiles: [{ id: "af-1", format: "mp3", objectKey: "a.mp3" }],
        },
      },
    ],
  });

  const recentlyPlayed = await screen.findByRole("heading", { name: /recently played/i });
  const recentPlaylists = screen.getByRole("heading", { name: /recent playlists/i });
  expect(
    recentlyPlayed.compareDocumentPosition(recentPlaylists) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("Finished Song")).toBeInTheDocument();
});

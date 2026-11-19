/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PlaylistCard } from "#app/components/playlist-card.tsx";
import PlaylistRoute from "./playlists.$playlistId.tsx";

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: null,
    isPlaying: false,
    playTrack: vi.fn(),
    pauseTrack: vi.fn(),
    resumeTrack: vi.fn(),
    playNextTrack: vi.fn(),
    addToUpNext: vi.fn(),
    addToQueue: vi.fn(),
    playUserPlaylist: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

afterEach(() => vi.unstubAllGlobals());

const now = new Date("2026-01-01T00:00:00Z");
const readOnlyTrack = {
  id: "pt-1",
  position: 0,
  createdAt: now,
  track: {
    id: "t-1",
    title: "Shared Song",
    artist: { id: "a-1", name: "Some Artist" },
    duration: 120,
    coverImage: null,
    albumRecord: null,
    serviceUrl: null,
    createdAt: now,
    releaseDate: null,
    originalDate: null,
    service: null,
    audioFiles: [{ id: "af-1", format: "mp3" }],
  },
};

function renderViewer(isLoggedIn: boolean) {
  const App = createRoutesStub([
    {
      path: "/playlists/:playlistId",
      Component: PlaylistRoute as never,
      loader: () => ({
        isOwner: false,
        isLoggedIn,
        playlist: {
          id: "pl-1",
          title: "Road Trip",
          description: "Songs for driving",
          createdAt: now,
          updatedAt: now,
          visibility: "PUBLIC",
          owner: { id: "u-1", username: "olive", name: "Olive" },
          tracks: [readOnlyTrack],
        },
      }),
      HydrateFallback: () => <div>Loading...</div>,
    },
  ]);
  return render(<App initialEntries={["/playlists/pl-1"]} />);
}

describe("playlist detail read-only view", () => {
  test("a logged-in viewer sees the playlist and can play, but has no mutation controls", async () => {
    renderViewer(true);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });
    expect(screen.getByText("Songs for driving")).toBeInTheDocument();
    expect(screen.getByText(/by olive/i)).toBeInTheDocument();
    expect(screen.getByText("Shared Song")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play shared song/i })).toBeInTheDocument();

    for (const name of [
      /delete/i,
      /add to playlist/i,
      /add to library/i,
      /download/i,
      /remove/i,
      /playlist visibility/i,
      /copy link/i,
      /add to up next/i,
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("an anonymous viewer sees the list but no play affordance", async () => {
    renderViewer(false);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });
    expect(screen.getByText("Shared Song")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play shared song/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in/i })).toBeInTheDocument();
  });
});

describe("owner visibility controls", () => {
  function renderOwner(visibility: "PRIVATE" | "PUBLIC" | "UNLISTED") {
    const App = createRoutesStub([
      {
        path: "/playlists/:playlistId",
        Component: PlaylistRoute as never,
        loader: () => ({
          isOwner: true,
          isLoggedIn: true,
          playlist: {
            id: "pl-1",
            title: "Mine",
            description: null,
            createdAt: now,
            updatedAt: now,
            visibility,
            tracks: [],
          },
          playlists: [],
        }),
        HydrateFallback: () => <div>Loading...</div>,
      },
    ]);
    return render(<App initialEntries={["/playlists/pl-1"]} />);
  }

  test("PRIVATE shows the visibility select and a make-public/unlisted affordance", async () => {
    renderOwner("PRIVATE");
    expect(await screen.findByRole("combobox", { name: /playlist visibility/i })).toHaveTextContent(
      /private/i,
    );
    expect(
      screen.getByRole("button", { name: /make public\/unlisted to share/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
  });

  test.each(["PUBLIC", "UNLISTED"] as const)("%s shows a copy-link control", async (visibility) => {
    renderOwner(visibility);
    expect(await screen.findByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /make public\/unlisted/i }),
    ).not.toBeInTheDocument();
  });
});

describe("PlaylistCard visibility badge", () => {
  test.each([
    ["PRIVATE", "Private"],
    ["PUBLIC", "Public"],
    ["UNLISTED", "Unlisted"],
  ] as const)("shows %s badge", async (visibility, label) => {
    const App = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <PlaylistCard
            id="p1"
            title="T"
            description={null}
            tracks={[]}
            createdAt={now.toISOString()}
            updatedAt={now.toISOString()}
            visibility={visibility}
          />
        ),
      },
    ]);
    render(<App initialEntries={["/"]} />);
    expect(await screen.findByTestId("playlist-visibility-badge")).toHaveTextContent(label);
  });
});

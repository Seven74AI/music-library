/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import SearchPage from "./search.tsx";

/**
 * Listener now-playing bar offset (room-speaker-bridge) plus the bar's own height.
 * The overlay stays at z-52, under dialogs (z-53), and must end above this bar.
 */
const ROOM_BAR_CLEARANCE =
  "calc(var(--bottom-bar-height, 64px) + var(--player-error-height, 0px) + env(safe-area-inset-bottom) + 4rem)";

type MockParty = {
  room: null | {
    status: string;
    code: string;
    me?: { id: string; role: string };
    currentHostParticipantId?: string;
    queue?: Array<{
      id: string;
      position: number;
      trackId: string;
      track: {
        id: string;
        title: string;
        artistName: string;
        duration: number | null;
        coverObjectKey: string | null;
        hasAudio: boolean;
      };
      addedByParticipantId: string;
      addedByDisplayName: string;
      createdAt: string;
    }>;
    playback?: { isPlaying: boolean; currentIndex: number; currentTrackId: string | null };
  };
  isHost: boolean;
};

let mockParty: MockParty = { room: null, isHost: false };

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
}));

const loveAlbum = {
  type: "album" as const,
  id: "album-love",
  name: "Love Album",
  artistName: "Tester",
  artistId: "artist-1",
  relevance: 1,
};

function renderSearch(initialEntry: string) {
  const urls: string[] = [];
  const router = createMemoryRouter(
    [
      {
        path: "/search",
        loader: () => ({ playlists: [] }),
        HydrateFallback: () => null,
        Component: SearchPage,
      },
      {
        path: "/api/search",
        loader: ({ request }) => {
          urls.push(request.url);
          const query = new URL(request.url).searchParams.get("q");
          return {
            results: query === "love" ? [loveAlbum] : [],
            pagination: { limit: 20, hasNext: false, nextCursor: null },
          };
        },
      },
      { path: "/rooms/:code", element: <p>Opened room</p> },
    ],
    { initialEntries: [initialEntry] },
  );

  const view = render(<RouterProvider router={router} />);
  return { urls, router, ...view };
}

function overlay() {
  return screen.getByTestId("search-overlay");
}

beforeEach(() => {
  localStorage.clear();
  mockParty = { room: null, isHost: false };
});

test("runs /search?q=love on open without another keystroke", async () => {
  const { urls } = renderSearch("/search?q=love");

  expect(await screen.findByPlaceholderText(/what do you want to listen to/i)).toHaveValue("love");

  await waitFor(() => {
    expect(urls.some((url) => new URL(url).searchParams.get("q") === "love")).toBe(true);
  });
  expect(await screen.findByText("Love Album")).toBeInTheDocument();
});

test("keeps the room bar uncovered and the in-room chip above results", async () => {
  mockParty = {
    isHost: false,
    room: {
      status: "open",
      code: "AB3K9Q",
      me: { id: "listener-1", role: "listener" },
      currentHostParticipantId: "host-1",
      queue: [
        {
          id: "q1",
          position: 0,
          trackId: "t1",
          track: {
            id: "t1",
            title: "Now Playing",
            artistName: "Artist",
            duration: 180,
            coverObjectKey: null,
            hasAudio: true,
          },
          addedByParticipantId: "host-1",
          addedByDisplayName: "Host",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      playback: { isPlaying: true, currentIndex: 0, currentTrackId: "t1" },
    },
  };

  const { router } = renderSearch("/search?q=love");
  await screen.findByPlaceholderText(/what do you want to listen to/i);
  const surface = overlay();

  // Dialogs use z-53. Stay under them; do not grow to cover the z-50 bar.
  expect(surface).toHaveClass("z-52");
  expect(surface.className).not.toMatch(/\bz-(5[3-9]|\d{3,})\b/);
  expect(surface).not.toHaveClass("inset-0");
  expect(surface).not.toHaveClass("h-dvh");
  expect(surface.style.bottom).toBe(ROOM_BAR_CLEARANCE);

  const chip = screen.getByRole("link", { name: /in room AB3K9Q/i });
  expect(surface).toContainElement(chip);
  expect(chip).toHaveAttribute("href", "/rooms/AB3K9Q");

  const result = await screen.findByText("Love Album");
  expect(chip.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );

  fireEvent.click(chip);
  await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
});

test("leaves search full-screen when no party room is open", async () => {
  renderSearch("/search");
  await screen.findByPlaceholderText(/what do you want to listen to/i);
  const surface = overlay();
  expect(surface).toHaveClass("inset-0");
  expect(surface).toHaveClass("z-52");
  expect(surface.style.bottom).toBe("");
  expect(screen.queryByRole("link", { name: /in room/i })).not.toBeInTheDocument();
});

test("shows the in-room chip for the host without reserving the listener bar", async () => {
  mockParty = {
    isHost: true,
    room: {
      status: "open",
      code: "AB3K9Q",
      me: { id: "host-1", role: "host" },
      currentHostParticipantId: "host-1",
      queue: [],
      playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
    },
  };

  renderSearch("/search");
  await screen.findByPlaceholderText(/what do you want to listen to/i);
  const surface = overlay();
  expect(screen.getByRole("link", { name: /in room AB3K9Q/i })).toHaveAttribute(
    "href",
    "/rooms/AB3K9Q",
  );
  expect(surface).toHaveClass("inset-0");
  expect(surface.style.bottom).toBe("");
});

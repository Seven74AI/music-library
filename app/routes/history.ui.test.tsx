/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import HistoryPage, { type HistoryItem } from "./history.tsx";

const mockPauseTrack = vi.fn();
const mockResumeTrack = vi.fn();
const mockPlayTrack = vi.fn();

const mockPlayerState: {
  currentTrack: { id: string } | null;
  isPlaying: boolean;
} = {
  currentTrack: null,
  isPlaying: false,
};

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: mockPlayerState.currentTrack,
    isPlaying: mockPlayerState.isPlaying,
    playTrack: mockPlayTrack,
    pauseTrack: mockPauseTrack,
    resumeTrack: mockResumeTrack,
  }),
}));

beforeEach(() => {
  mockPauseTrack.mockClear();
  mockResumeTrack.mockClear();
  mockPlayTrack.mockClear();
  mockPlayerState.currentTrack = null;
  mockPlayerState.isPlaying = false;
});

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
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    value: MockIntersectionObserver,
  });
});

function makeItem(overrides: {
  id: string;
  trackId: string;
  title: string;
  artist?: string;
}): HistoryItem {
  return {
    id: overrides.id,
    playId: overrides.id,
    completed: true,
    playedAt: "2026-09-23T12:00:00.000Z",
    track: {
      id: overrides.trackId,
      title: overrides.title,
      artist: { id: `artist-${overrides.trackId}`, name: overrides.artist ?? "Artist" },
      duration: 180,
      coverImage: null,
      serviceUrl: null,
      service: { displayName: "Local Upload", logoUrl: null },
      audioFiles: [{ id: `af-${overrides.trackId}`, format: "mp3", objectKey: "audio/x.mp3" }],
    },
  };
}

function renderHistory(items: HistoryItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: (
          <HistoryPage
            loaderData={{ items, nextCursor: null } as never}
            params={{}}
            matches={[] as never}
          />
        ),
      },
    ],
    { initialEntries: ["/history"] },
  );

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<RouterProvider router={router} />, { wrapper: Wrapper });
}

test("shows a Collapse tracks checkbox unchecked by default and lists every play", () => {
  renderHistory([
    makeItem({ id: "p1", trackId: "t1", title: "Song A" }),
    makeItem({ id: "p2", trackId: "t1", title: "Song A" }),
    makeItem({ id: "p3", trackId: "t2", title: "Song B" }),
  ]);

  const checkbox = screen.getByRole("checkbox", { name: /collapse tracks/i });
  expect(checkbox).not.toBeChecked();

  const list = screen.getByRole("list");
  expect(within(list).getAllByText("Song A")).toHaveLength(2);
  expect(within(list).getByText("Song B")).toBeInTheDocument();
});

test("collapsing tracks keeps one row per distinct track", async () => {
  const user = userEvent.setup();
  renderHistory([
    makeItem({ id: "p1", trackId: "t1", title: "Song A" }),
    makeItem({ id: "p2", trackId: "t1", title: "Song A" }),
    makeItem({ id: "p3", trackId: "t2", title: "Song B" }),
  ]);

  await user.click(screen.getByRole("checkbox", { name: /collapse tracks/i }));

  const list = screen.getByRole("list");
  expect(within(list).getAllByText("Song A")).toHaveLength(1);
  expect(within(list).getByText("Song B")).toBeInTheDocument();
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
});

test("history row pauses the current playing track instead of restarting", async () => {
  const user = userEvent.setup();
  const item = makeItem({ id: "p1", trackId: "t1", title: "Song A" });
  mockPlayerState.currentTrack = { id: "t1" };
  mockPlayerState.isPlaying = true;

  renderHistory([item]);

  await user.click(screen.getByRole("button", { name: /pause song a/i }));

  expect(mockPauseTrack).toHaveBeenCalledTimes(1);
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("history row resumes the paused current track", async () => {
  const user = userEvent.setup();
  const item = makeItem({ id: "p1", trackId: "t1", title: "Song A" });
  mockPlayerState.currentTrack = { id: "t1" };
  mockPlayerState.isPlaying = false;

  renderHistory([item]);

  await user.click(screen.getByRole("button", { name: /resume song a/i }));

  expect(mockResumeTrack).toHaveBeenCalledTimes(1);
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

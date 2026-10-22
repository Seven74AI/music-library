/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { PlaylistCard } from "./playlist-card.tsx";

const mockPlayUserPlaylist = vi.fn();

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    playUserPlaylist: mockPlayUserPlaylist,
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

const baseTrack = {
  id: "track-1",
  title: "Midnight City",
  artist: { id: "artist-1", name: "M83" },
  duration: 245,
  coverImage: { objectKey: "covers/midnight-city.jpg" },
};

const updatedAt = "2024-06-01T00:00:00.000Z";
const updatedLabel = `Updated ${new Date(updatedAt).toLocaleDateString()}`;

function renderCard(props: Partial<ComponentProps<typeof PlaylistCard>> = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <PlaylistCard
            id="playlist-1"
            title="Chill Vibes"
            description="Late night listening"
            tracks={[baseTrack]}
            createdAt="2024-01-01T00:00:00.000Z"
            updatedAt={updatedAt}
            {...props}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  mockPlayUserPlaylist.mockClear();
});

test("plays the playlist when the play button is clicked", async () => {
  const user = userEvent.setup();
  renderCard();

  await user.click(screen.getByRole("button", { name: /play chill vibes/i }));

  expect(mockPlayUserPlaylist).toHaveBeenCalledWith("playlist-1");
});

test("does not render an edit button", () => {
  renderCard();

  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/edit/i)).not.toBeInTheDocument();
});

test("hides play when the playlist has no tracks", () => {
  renderCard({ tracks: [] });

  expect(screen.queryByRole("button", { name: /play chill vibes/i })).not.toBeInTheDocument();
  expect(mockPlayUserPlaylist).not.toHaveBeenCalled();
});

test("uses trackCount when preview tracks are truncated", () => {
  renderCard({
    tracks: [baseTrack],
    trackCount: 12,
  });

  expect(screen.getByText(`12 tracks · ${updatedLabel}`)).toBeInTheDocument();
});

test("falls back to tracks.length when trackCount is omitted", () => {
  renderCard({ tracks: [baseTrack] });

  expect(screen.getByText(`1 track · ${updatedLabel}`)).toBeInTheDocument();
});

test("shows description when present", () => {
  renderCard();

  expect(screen.getByText("Late night listening")).toBeInTheDocument();
});

test("omits description when null", () => {
  renderCard({ description: null });

  expect(screen.queryByText("Late night listening")).not.toBeInTheDocument();
});

test("does not show playlist duration", () => {
  renderCard({
    tracks: [baseTrack],
    trackCount: 12,
    totalDuration: 3600,
  });

  expect(screen.queryByText("1:00:00")).not.toBeInTheDocument();
  expect(screen.queryByText("4:05")).not.toBeInTheDocument();
});

test("list variant uses a horizontal row layout", () => {
  renderCard({ variant: "list" });

  expect(screen.getByTestId("playlist-card")).toHaveAttribute("data-variant", "list");
});

test("grid variant uses a stacked tile layout", () => {
  renderCard({ variant: "grid" });

  expect(screen.getByTestId("playlist-card")).toHaveAttribute("data-variant", "grid");
});

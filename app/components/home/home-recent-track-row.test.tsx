/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { type HomeRecentTrack } from "#app/utils/home.server.ts";
import { HomeRecentTrackRow } from "./home-recent-track-row.tsx";

const mockPlayTrack = vi.fn();

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: null,
    currentIndex: 0,
    playTrack: mockPlayTrack,
  }),
}));

type MakeTrackOverrides = Omit<Partial<HomeRecentTrack>, "track"> & {
  track?: Partial<HomeRecentTrack["track"]>;
};

const makeTrack = (overrides: MakeTrackOverrides = {}): HomeRecentTrack => {
  const { track: trackOverrides, ...userTrackOverrides } = overrides;

  return {
    id: "user-track-1",
    createdAt: new Date("2024-01-01"),
    track: {
      id: "track-1",
      title: "Midnight City",
      duration: 245,
      serviceUrl: "https://youtube.com/watch?v=test",
      artist: { id: "artist-1", name: "M83" },
      coverImage: { objectKey: "covers/midnight-city.jpg" },
      service: { name: "youtube", displayName: "YouTube", logoUrl: null },
      audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/midnight.mp3" }],
      ...trackOverrides,
    },
    ...userTrackOverrides,
  };
};

beforeEach(() => {
  mockPlayTrack.mockClear();
});

test("shows empty state when there are no tracks", () => {
  render(<HomeRecentTrackRow recentTracks={[]} />);

  expect(screen.getByText("No tracks yet")).toBeInTheDocument();
});

test("renders track title and artist in compact cards", () => {
  render(
    <HomeRecentTrackRow
      recentTracks={[
        makeTrack(),
        makeTrack({
          id: "user-track-2",
          track: {
            id: "track-2",
            title: "La Femme d'argent",
            artist: { id: "artist-2", name: "Air" },
          },
        }),
      ]}
    />,
  );

  expect(screen.getByText("Midnight City")).toBeInTheDocument();
  expect(screen.getByText("M83")).toBeInTheDocument();
  expect(screen.getByText("La Femme d'argent")).toBeInTheDocument();
  expect(screen.getByText("Air")).toBeInTheDocument();
});

test("plays a track when its card is clicked", async () => {
  const user = userEvent.setup();
  const recentTrack = makeTrack();

  render(<HomeRecentTrackRow recentTracks={[recentTrack]} />);

  await user.click(screen.getByRole("button", { name: /midnight city/i }));

  expect(mockPlayTrack).toHaveBeenCalledWith(recentTrack.track, { type: "library" }, 0);
});

test("does not play tracks that are still archiving", async () => {
  const user = userEvent.setup();

  render(<HomeRecentTrackRow recentTracks={[makeTrack({ track: { audioFiles: [] } })]} />);

  const card = screen.getByRole("button", { name: /midnight city/i });
  expect(card).toBeDisabled();

  await user.click(card);
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

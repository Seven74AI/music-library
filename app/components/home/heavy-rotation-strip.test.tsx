/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { type HeavyRotationTrack } from "#app/features/listening-insights/index.ts";
import { HeavyRotationStrip } from "./heavy-rotation-strip.tsx";

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: null,
    currentIndex: 0,
    playPlaylist: vi.fn(),
  }),
}));

function makeTrack(
  overrides: Partial<HeavyRotationTrack> & { track?: Partial<HeavyRotationTrack["track"]> } = {},
): HeavyRotationTrack {
  const { track: trackOverrides, ...rest } = overrides;
  return {
    completedCount: 3,
    track: {
      id: "track-1",
      title: "Midnight City",
      duration: 245,
      serviceUrl: null,
      artist: { id: "artist-1", name: "M83" },
      coverImage: null,
      service: null,
      audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/m.mp3" }],
      ...trackOverrides,
    },
    ...rest,
  };
}

function renderStrip(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

test("renders nothing when there are no tracks (hide when empty)", () => {
  const { container } = renderStrip(
    <HeavyRotationStrip
      title="Heavy Rotation · this month"
      tracks={[]}
      librarySort="mostPlayedMonth"
    />,
  );
  // RouterProvider wraps the strip; empty strip contributes no section content.
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(container.querySelector("section")).toBeNull();
});

test("renders title, view-all link, and track tiles when non-empty", () => {
  renderStrip(
    <HeavyRotationStrip
      title="Heavy Rotation · this month"
      tracks={[
        makeTrack(),
        makeTrack({
          completedCount: 1,
          track: {
            id: "track-2",
            title: "Warm Track",
            duration: 200,
            serviceUrl: null,
            artist: { id: "a2", name: "Air" },
            coverImage: null,
            service: null,
            audioFiles: [],
          },
        }),
      ]}
      librarySort="mostPlayedMonth"
    />,
  );

  expect(screen.getByRole("heading", { name: /heavy rotation · this month/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute(
    "href",
    "/library?sort=mostPlayedMonth",
  );
  expect(screen.getByText("Midnight City")).toBeInTheDocument();
  expect(screen.getByText("Warm Track")).toBeInTheDocument();
});

test("ever strip links to the ever library sort", () => {
  renderStrip(
    <HeavyRotationStrip
      title="Heavy Rotation · ever"
      tracks={[makeTrack()]}
      librarySort="mostPlayedEver"
    />,
  );

  expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute(
    "href",
    "/library?sort=mostPlayedEver",
  );
});

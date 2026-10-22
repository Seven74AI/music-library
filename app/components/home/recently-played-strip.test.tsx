/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { type RecentlyPlayedTrack } from "#app/features/recently-played/recently-played.server.ts";
import { RecentlyPlayedStrip } from "./recently-played-strip.tsx";

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    currentTrack: null,
    currentIndex: 0,
    playPlaylist: vi.fn(),
  }),
}));

function makeTrack(overrides: Partial<RecentlyPlayedTrack["track"]> = {}): RecentlyPlayedTrack {
  return {
    playedAt: new Date("2026-09-23T12:00:00.000Z"),
    track: {
      id: "track-1",
      title: "Midnight City",
      duration: 245,
      serviceUrl: null,
      artist: { id: "artist-1", name: "M83" },
      coverImage: null,
      service: { name: "youtube", displayName: "YouTube", logoUrl: null },
      audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/midnight.mp3" }],
      ...overrides,
    },
  };
}

function renderStrip(tracks: RecentlyPlayedTrack[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <RecentlyPlayedStrip tracks={tracks} />,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

test("omits the strip entirely when there are no recently played tracks", () => {
  const { container } = renderStrip([]);

  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole("heading", { name: /recently played/i })).not.toBeInTheDocument();
});

test("renders a Recently played heading and playable track tiles when non-empty", () => {
  renderStrip([
    makeTrack(),
    makeTrack({
      id: "track-2",
      title: "La Femme d'argent",
      artist: { id: "artist-2", name: "Air" },
    }),
  ]);

  expect(screen.getByRole("heading", { name: /recently played/i })).toBeInTheDocument();
  expect(screen.getByText("Midnight City")).toBeInTheDocument();
  expect(screen.getByText("M83")).toBeInTheDocument();
  expect(screen.getByText("La Femme d'argent")).toBeInTheDocument();
  expect(screen.getByText("Air")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /midnight city/i })).toBeEnabled();
});

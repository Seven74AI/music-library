/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import GuestSearchLayout from "./rooms.$code.search.tsx";
import RoomArtistPage from "./rooms.$code.search.artists.$artistId.tsx";

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => ({ room: null }),
  usePartyRoom: () => ({ room: null }),
}));

const artist = {
  id: "artist-1",
  name: "Ada",
  genre: "Jazz",
  imageObjectKey: null,
  trackCount: 120,
  albums: [
    {
      id: "album-1",
      name: "Blue Notes",
      year: 1974,
      coverObjectKey: null,
      trackCount: 1,
    },
  ],
  tracks: [
    {
      id: "track-1",
      title: "First Light",
      artistName: "Ada",
      artistId: "artist-1",
      albumName: "Blue Notes",
      albumId: "album-1",
      duration: 90,
      trackNumber: null,
    },
  ],
};

function renderArtist() {
  const router = createMemoryRouter(
    [
      {
        path: "/rooms/:code/search",
        HydrateFallback: () => null,
        Component: GuestSearchLayout,
        loader: () => ({
          code: "AB3K9Q",
          role: "listener",
          canAddTracks: false,
          displayName: "Walkup",
        }),
        children: [
          {
            path: "artists/:artistId",
            HydrateFallback: () => null,
            Component: RoomArtistPage,
            loader: () => ({ code: "AB3K9Q", artist }),
          },
        ],
      },
    ],
    { initialEntries: ["/rooms/AB3K9Q/search/artists/artist-1"] },
  );
  return render(<RouterProvider router={router} />);
}

test("artist page opens playable albums and hides add for a listener", async () => {
  renderArtist();

  expect(await screen.findByRole("heading", { name: "Ada" })).toBeInTheDocument();
  expect(screen.getByText(/Jazz/)).toBeInTheDocument();
  const albumLinks = screen.getAllByRole("link", { name: /blue notes/i });
  expect(albumLinks.map((link) => link.getAttribute("href"))).toContain(
    "/rooms/AB3K9Q/search/albums/album-1",
  );
  expect(screen.getByText(/Showing 1 of 120 playable tracks/)).toBeInTheDocument();
  expect(screen.getByText(/First Light/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /add first light/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /audition first light/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to search/i })).toHaveAttribute(
    "href",
    "/rooms/AB3K9Q/search",
  );
});

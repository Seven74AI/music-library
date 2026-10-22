/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import GuestSearchLayout from "./rooms.$code.search.tsx";
import RoomAlbumPage from "./rooms.$code.search.albums.$albumId.tsx";

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => ({ room: null }),
  usePartyRoom: () => ({ room: null }),
}));

const album = {
  id: "album-1",
  name: "Blue Notes",
  year: 1974,
  coverObjectKey: null,
  artist: { id: "artist-1", name: "Ada" },
  tracks: [
    {
      id: "track-1",
      title: "First Light",
      artistName: "Ada",
      artistId: "artist-1",
      albumName: "Blue Notes",
      albumId: "album-1",
      duration: 180,
      trackNumber: 1,
    },
  ],
};

function renderAlbum(initialState?: { q: string; type: string }) {
  const router = createMemoryRouter(
    [
      {
        path: "/rooms/:code/search",
        HydrateFallback: () => null,
        Component: GuestSearchLayout,
        loader: () => ({
          code: "AB3K9Q",
          role: "dj",
          canAddTracks: true,
          displayName: "Walkup",
        }),
        children: [
          {
            path: "albums/:albumId",
            HydrateFallback: () => null,
            Component: RoomAlbumPage,
            loader: () => ({ code: "AB3K9Q", album }),
          },
          { path: "artists/:artistId", element: <p>Opened artist</p> },
        ],
      },
    ],
    {
      initialEntries: [
        {
          pathname: "/rooms/AB3K9Q/search/albums/album-1",
          state: initialState,
        },
      ],
    },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

test("album page links back to the search that opened it and lists playable tracks", async () => {
  renderAlbum({ q: "blue", type: "albums" });

  expect(await screen.findByRole("heading", { name: "Blue Notes" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /back to search/i })).toHaveAttribute(
    "href",
    "/rooms/AB3K9Q/search?q=blue&type=albums",
  );
  const artistLinks = screen.getAllByRole("link", { name: "Ada" });
  expect(artistLinks.length).toBeGreaterThan(0);
  for (const link of artistLinks) {
    expect(link).toHaveAttribute("href", "/rooms/AB3K9Q/search/artists/artist-1");
  }
  expect(screen.getByText(/First Light/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add first light to the room queue/i })).toBeEnabled();
  expect(screen.getByRole("button", { name: /audition first light/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /add first light to the room queue/i }));
  expect(await screen.findByText(/added “First Light” to the room queue/i)).toBeInTheDocument();
});

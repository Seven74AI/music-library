/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { HistoryTab } from "./history-tab.tsx";

test("edit preview shows artist and album names instead of ids", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <HistoryTab trackId="track-1" onRestore={vi.fn()} />,
      },
      {
        path: "/api/metadata/tracks/:trackId/history",
        loader: () => ({
          history: [
            {
              id: "edit-1",
              editedAt: "2026-01-01T00:00:00.000Z",
              editedBy: { id: "user-1", username: "kody", name: "Kody" },
              comment: "Fixed the credit",
              changes: {
                artistId: { from: "artist-old", to: "artist-new" },
                albumId: { from: null, to: "album-new" },
              },
              labels: {
                artistId: { from: "Bill Evans", to: "Miles Davis" },
                albumId: { from: "(empty)", to: "Kind of Blue" },
              },
            },
          ],
        }),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByText(/Bill Evans/)).toBeInTheDocument();
  expect(screen.getByText(/Miles Davis/)).toBeInTheDocument();
  expect(screen.getByText(/Kind of Blue/)).toBeInTheDocument();
  expect(screen.queryByText(/artist-old/)).not.toBeInTheDocument();
  expect(screen.queryByText(/artist-new/)).not.toBeInTheDocument();
  expect(screen.queryByText(/album-new/)).not.toBeInTheDocument();
});

test("reloads history when the track id changes and hides the previous track", async () => {
  const urls: string[] = [];
  let setTrackId = (_trackId: string) => {};

  function Harness() {
    const [trackId, setId] = useState("track-1");
    setTrackId = setId;
    return <HistoryTab trackId={trackId} onRestore={vi.fn()} />;
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/metadata/tracks/:trackId/history",
        loader: ({ params, request }) => {
          urls.push(new URL(request.url).pathname);
          const trackId = params.trackId;
          return {
            history: [
              {
                id: `edit-${trackId}`,
                editedAt: "2026-01-01T00:00:00.000Z",
                editedBy: { id: "user-1", username: "kody", name: "Kody" },
                comment: trackId === "track-1" ? "First track note" : "Second track note",
                changes: {
                  title: {
                    from: trackId === "track-1" ? "Opening Song" : "Later Song",
                    to: "Renamed",
                  },
                },
              },
            ],
          };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByText(/First track note/)).toBeInTheDocument();
  expect(screen.getByText(/Opening Song/)).toBeInTheDocument();

  await act(async () => {
    setTrackId("track-2");
  });

  expect(screen.queryByText(/First track note/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Opening Song/)).not.toBeInTheDocument();
  expect(await screen.findByText(/Second track note/)).toBeInTheDocument();
  expect(screen.getByText(/Later Song/)).toBeInTheDocument();
  expect(urls.filter((url) => url.includes("/tracks/track-2/history"))).toEqual([
    "/api/metadata/tracks/track-2/history",
  ]);
});

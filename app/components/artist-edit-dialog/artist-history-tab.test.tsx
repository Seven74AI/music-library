/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { ArtistHistoryTab } from "./artist-history-tab";

const previousSnapshot = {
  id: "edit-previous",
  editedAt: "2026-01-01T00:00:00.000Z",
  editedBy: { id: "user-1", username: "kody", name: "Kody" },
  comment: "Before the rename",
  changes: { name: { from: "Meryl", to: "Meryl Checked" } },
};

test("offers restore for the previous artist snapshot", async () => {
  const user = userEvent.setup();
  const onRestore = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <ArtistHistoryTab artistId="artist-1" onRestore={onRestore} />,
      },
      {
        path: "/api/metadata/artists/:artistId/history",
        loader: () => ({ history: [previousSnapshot] }),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await user.click(await screen.findByRole("button", { name: "Restore" }));
  await user.type(screen.getByLabelText(/^Comment/), "Put the earlier name back");
  await user.click(screen.getByRole("button", { name: "Submit" }));

  expect(onRestore).toHaveBeenCalledWith("edit-previous", "Put the earlier name back");
});

test("reloads history when the artist id changes and hides the previous artist", async () => {
  const urls: string[] = [];
  let setArtistId = (_artistId: string) => {};

  function Harness() {
    const [artistId, setId] = useState("artist-1");
    setArtistId = setId;
    return <ArtistHistoryTab artistId={artistId} onRestore={vi.fn()} />;
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/metadata/artists/:artistId/history",
        loader: ({ params, request }) => {
          urls.push(new URL(request.url).pathname);
          const artistId = params.artistId;
          return {
            history: [
              {
                id: `edit-${artistId}`,
                editedAt: "2026-01-01T00:00:00.000Z",
                editedBy: { id: "user-1", username: "kody", name: "Kody" },
                comment: artistId === "artist-1" ? "First artist note" : "Second artist note",
                changes: {
                  name: {
                    from: artistId === "artist-1" ? "Meryl" : "Nora",
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

  expect(await screen.findByText(/First artist note/)).toBeInTheDocument();
  expect(screen.getByText(/Meryl/)).toBeInTheDocument();

  await act(async () => {
    setArtistId("artist-2");
  });

  expect(screen.queryByText(/First artist note/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Meryl/)).not.toBeInTheDocument();
  expect(await screen.findByText(/Second artist note/)).toBeInTheDocument();
  expect(screen.getByText(/Nora/)).toBeInTheDocument();
  expect(urls.filter((url) => url.includes("/artists/artist-2/history"))).toEqual([
    "/api/metadata/artists/artist-2/history",
  ]);
});

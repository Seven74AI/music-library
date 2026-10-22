/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { AlbumHistoryTab } from "./album-history-tab";

const previousSnapshot = {
  id: "edit-previous",
  editedAt: "2026-01-01T00:00:00.000Z",
  editedBy: { id: "user-1", username: "kody", name: "Kody" },
  comment: "Before the rename",
  changes: { name: { from: "Jour avant caviar", to: "Jour avant caviar Renamed" } },
};

test("offers restore for the previous album snapshot", async () => {
  const user = userEvent.setup();
  const onRestore = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AlbumHistoryTab albumId="album-1" onRestore={onRestore} />,
      },
      {
        path: "/api/metadata/albums/:albumId/history",
        loader: () => ({ history: [previousSnapshot] }),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await user.click(await screen.findByRole("button", { name: "Restore" }));
  await user.type(screen.getByLabelText(/^Comment/), "Put the earlier album back");
  await user.click(screen.getByRole("button", { name: "Submit" }));

  expect(onRestore).toHaveBeenCalledWith("edit-previous", "Put the earlier album back");
});

test("reloads history when the album id changes and hides the previous album", async () => {
  const urls: string[] = [];
  let setAlbumId = (_albumId: string) => {};

  function Harness() {
    const [albumId, setId] = useState("album-1");
    setAlbumId = setId;
    return <AlbumHistoryTab albumId={albumId} onRestore={vi.fn()} />;
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/metadata/albums/:albumId/history",
        loader: ({ params, request }) => {
          urls.push(new URL(request.url).pathname);
          const albumId = params.albumId;
          return {
            history: [
              {
                id: `edit-${albumId}`,
                editedAt: "2026-01-01T00:00:00.000Z",
                editedBy: { id: "user-1", username: "kody", name: "Kody" },
                comment: albumId === "album-1" ? "First album note" : "Second album note",
                changes: {
                  name: {
                    from: albumId === "album-1" ? "Abbey Road" : "Revolver",
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

  expect(await screen.findByText(/First album note/)).toBeInTheDocument();
  expect(screen.getByText(/Abbey Road/)).toBeInTheDocument();

  await act(async () => {
    setAlbumId("album-2");
  });

  expect(screen.queryByText(/First album note/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Abbey Road/)).not.toBeInTheDocument();
  expect(await screen.findByText(/Second album note/)).toBeInTheDocument();
  expect(screen.getByText(/Revolver/)).toBeInTheDocument();
  expect(urls.filter((url) => url.includes("/albums/album-2/history"))).toEqual([
    "/api/metadata/albums/album-2/history",
  ]);
});

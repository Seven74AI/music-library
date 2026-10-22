/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { AlbumMergeDialog, type AlbumOption } from "./album-merge-dialog";

const pairA: [AlbumOption, AlbumOption] = [
  { id: "album-a1", name: "Album A", trackCount: 2, year: 2000 },
  { id: "album-a2", name: "Album B", trackCount: 3, year: 2001 },
];

const pairB: [AlbumOption, AlbumOption] = [
  { id: "album-b1", name: "Album C", trackCount: 4, year: 2002 },
  { id: "album-b2", name: "Album D", trackCount: 5, year: 2003 },
];

test("does not re-fire onMerged when reopening after a successful merge", async () => {
  const user = userEvent.setup();
  const onMerged = vi.fn();
  let reopen = () => {};

  function Harness() {
    const [pairIndex, setPairIndex] = useState(0);
    const [open, setOpen] = useState(true);
    reopen = () => {
      setPairIndex(1);
      setOpen(true);
    };
    const [source, target] = pairIndex === 0 ? pairA : pairB;
    return (
      <AlbumMergeDialog
        sourceAlbum={source}
        targetAlbum={target}
        artistName="Test Artist"
        open={open}
        onOpenChange={setOpen}
        onMerged={onMerged}
      />
    );
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/metadata/albums/merge",
        action: async () => ({ ok: true }),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  // First merge for pair A
  await user.type(screen.getByLabelText(/Merge Reason/), "Duplicates");
  await user.click(screen.getByLabelText(/I understand this action will merge/));
  await user.click(screen.getByRole("button", { name: "Confirm Merge" }));

  await waitFor(() => {
    expect(onMerged).toHaveBeenCalledTimes(1);
  });

  // Reopen for a different pair — stale mergeFetcher.data must not auto-close
  await act(async () => {
    reopen();
  });

  expect(onMerged).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Album C")).toBeTruthy();
  expect(screen.getByText("Album D")).toBeTruthy();
});

/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { ArtistMergeDialog, type ArtistOption } from "./artist-merge-dialog";

const pairA: [ArtistOption, ArtistOption] = [
  { id: "artist-a1", name: "Artist A", trackCount: 2, albumCount: 1 },
  { id: "artist-a2", name: "Artist B", trackCount: 3, albumCount: 2 },
];

const pairB: [ArtistOption, ArtistOption] = [
  { id: "artist-b1", name: "Artist C", trackCount: 4, albumCount: 3 },
  { id: "artist-b2", name: "Artist D", trackCount: 5, albumCount: 4 },
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
      <ArtistMergeDialog
        sourceArtist={source}
        targetArtist={target}
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
        path: "/api/metadata/artists/merge",
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
  expect(screen.getByText("Artist C")).toBeTruthy();
  expect(screen.getByText("Artist D")).toBeTruthy();
});

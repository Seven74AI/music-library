/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { ArtistSplitDialog, type TrackOption } from "./artist-split-dialog";

const alphaTracks: TrackOption[] = [
  { id: "track-alpha-1", title: "Alpha One", album: "Alpha Album" },
  { id: "track-alpha-2", title: "Alpha Two", album: "Alpha Album" },
];

const betaTracks: TrackOption[] = [
  { id: "track-beta-1", title: "Beta One", album: "Beta Album" },
  { id: "track-beta-2", title: "Beta Two", album: "Beta Album" },
];

test("clears the split form when the artist id changes", async () => {
  const user = userEvent.setup();
  let setArtistId = (_id: string) => {};
  const submissions: Array<{ id: string; body: unknown }> = [];

  function Harness() {
    const [artistId, setCurrent] = useState("artist-a");
    setArtistId = setCurrent;
    const isAlpha = artistId === "artist-a";
    return (
      <ArtistSplitDialog
        artistId={artistId}
        artistName={isAlpha ? "Alpha" : "Beta"}
        tracks={isAlpha ? alphaTracks : betaTracks}
        open
        onOpenChange={() => {}}
      />
    );
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/metadata/artists/:id/split",
        action: async ({ request, params }) => {
          submissions.push({
            id: params.id ?? "",
            body: await request.json(),
          });
          return { ok: true };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await user.type(screen.getByLabelText(/New Artist Name/), "Spun Off");
  await user.type(screen.getByLabelText(/Split Reason/), "Separating a feature");
  await user.click(screen.getByText("Alpha One"));
  await user.click(screen.getByLabelText(/I understand this will create a new artist/));

  await act(async () => {
    setArtistId("artist-b");
  });

  expect(screen.queryByText("Alpha One")).toBeNull();
  expect(screen.queryByText("Alpha Two")).toBeNull();
  expect(screen.getByText("Beta One")).toBeTruthy();
  expect(screen.getByText("Beta Two")).toBeTruthy();
  expect(screen.getByLabelText(/New Artist Name/)).toHaveValue("");
  expect(screen.getByLabelText(/Split Reason/)).toHaveValue("");
  expect(screen.getByText(/0 of 2 selected/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Split Artist" }).hasAttribute("disabled")).toBe(true);

  await user.type(screen.getByLabelText(/New Artist Name/), "Beta Split");
  await user.type(screen.getByLabelText(/Split Reason/), "Beta reason");
  await user.click(screen.getByText("Beta One"));
  await user.click(screen.getByLabelText(/I understand this will create a new artist/));
  await user.click(screen.getByRole("button", { name: "Split Artist" }));

  await waitFor(() => {
    expect(submissions).toHaveLength(1);
  });
  expect(submissions).toEqual([
    {
      id: "artist-b",
      body: {
        trackIds: ["track-beta-1"],
        newArtistName: "Beta Split",
        comment: "Beta reason",
      },
    },
  ]);
});

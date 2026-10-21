/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { SortableTrackList } from "./sortable-track-list";

vi.mock("./track-list-item", () => ({
  TrackListItem: () => <div>Track row</div>,
}));

const tracks = [
  {
    id: "pt-1",
    position: 1,
    track: {
      id: "track-1",
      title: "Song",
      artist: { id: "artist-1", name: "Artist" },
      duration: 180,
      coverImage: null,
      serviceUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
];

function renderList() {
  return render(
    <SortableTrackList
      tracks={tracks}
      playlists={[]}
      playlistId="playlist-1"
      onReorder={vi.fn()}
      onRemoveTrack={vi.fn()}
      onBulkRemove={vi.fn()}
      onBulkPlayNext={vi.fn()}
      onBulkAddToUpNext={vi.fn()}
      onBulkAddToQueue={vi.fn()}
    />,
  );
}

test("bulk select actions sit on a second row on small screens", async () => {
  const user = userEvent.setup();
  renderList();

  await user.click(screen.getByRole("button", { name: /enable track selection mode/i }));

  const toolbar = screen.getByRole("toolbar", {
    name: /bulk actions for selected tracks/i,
  });
  expect(toolbar.className).toContain("flex-col");
  expect(toolbar.className).toContain("sm:flex-row");

  const actions = screen.getByRole("group", { name: /bulk track actions/i });
  const children = Array.from(toolbar.children);
  expect(children[0]).toHaveTextContent(/selected/i);
  expect(children.at(-1)).toBe(actions);
  expect(actions).toHaveTextContent(/add to up next/i);
  expect(actions).toHaveTextContent(/remove selected/i);
});

function playlistTrack(id: string, title: string) {
  return {
    id,
    position: 1,
    track: {
      id: `track-${id}`,
      title,
      artist: { id: "artist-1", name: "Artist" },
      duration: 180,
      coverImage: null,
      serviceUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

test("clears a selection when the playlist id changes", async () => {
  const user = userEvent.setup();
  const onBulkRemove = vi.fn();
  let setPlaylistId = (_id: string) => {};

  function Harness() {
    const [playlistId, setCurrent] = useState("playlist-a");
    setPlaylistId = setCurrent;
    const isAlpha = playlistId === "playlist-a";
    return (
      <SortableTrackList
        tracks={[
          playlistTrack(isAlpha ? "pt-alpha" : "pt-beta", isAlpha ? "Alpha Song" : "Beta Song"),
        ]}
        playlists={[]}
        playlistId={playlistId}
        onReorder={vi.fn()}
        onRemoveTrack={vi.fn()}
        onBulkRemove={onBulkRemove}
        onBulkPlayNext={vi.fn()}
        onBulkAddToUpNext={vi.fn()}
        onBulkAddToQueue={vi.fn()}
      />
    );
  }

  render(<Harness />);

  await user.click(screen.getByRole("button", { name: /enable track selection mode/i }));
  await user.click(screen.getByRole("checkbox", { name: /select all 1 tracks/i }));
  expect(screen.getByText("1 track selected")).toBeTruthy();
  expect(screen.getByRole("listitem", { name: /Alpha Song/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await act(async () => {
    setPlaylistId("playlist-b");
  });

  expect(screen.getByRole("listitem", { name: /Beta Song/ })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  expect(screen.queryByRole("listitem", { name: /Alpha Song/ })).toBeNull();
  expect(screen.queryByText("1 track selected")).toBeNull();
  expect(
    screen.queryByRole("toolbar", {
      name: /bulk actions for selected tracks/i,
    }),
  ).toBeNull();
  expect(onBulkRemove).not.toHaveBeenCalled();
});

/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  const toolbar = screen.getByRole("toolbar", { name: /bulk actions for selected tracks/i });
  expect(toolbar.className).toContain("flex-col");
  expect(toolbar.className).toContain("sm:flex-row");

  const actions = screen.getByRole("group", { name: /bulk track actions/i });
  const children = Array.from(toolbar.children);
  expect(children[0]).toHaveTextContent(/selected/i);
  expect(children.at(-1)).toBe(actions);
  expect(actions).toHaveTextContent(/add to up next/i);
  expect(actions).toHaveTextContent(/remove selected/i);
});

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

function installRowRects() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.getAttribute("role") === "listitem") {
      const label = this.getAttribute("aria-label") ?? "";
      const match = /^Track (\d+):/.exec(label);
      const index = match ? Number(match[1]) - 1 : 0;
      const top = index * 80;
      return new DOMRect(0, top, 320, 64);
    }
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function renderReorderList() {
  const onReorder = vi.fn();
  render(
    <SortableTrackList
      tracks={[playlistTrack("pt-1", "Alpha"), playlistTrack("pt-2", "Beta")]}
      playlists={[]}
      playlistId="playlist-1"
      onReorder={onReorder}
      onRemoveTrack={vi.fn()}
      onBulkRemove={vi.fn()}
      onBulkPlayNext={vi.fn()}
      onBulkAddToUpNext={vi.fn()}
      onBulkAddToQueue={vi.fn()}
    />,
  );
  return { onReorder };
}

function dragHandle(trackNumber: number, title: string) {
  return screen.getByRole("button", {
    name: new RegExp(`drag handle for track ${trackNumber}: ${title}`, "i"),
  });
}

/** KeyboardSensor attaches its document listener on the next turn. */
async function flushKeyboardSensor() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("keyboard reorder moves a track with space and arrow keys", async () => {
  const user = userEvent.setup();
  const restoreRects = installRowRects();
  try {
    const { onReorder } = renderReorderList();
    const handle = dragHandle(1, "Alpha");
    handle.focus();

    await user.keyboard("[Space]");
    expect(handle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/started dragging track "alpha"/i)).toBeTruthy();

    await flushKeyboardSensor();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("[Space]");

    expect(onReorder).toHaveBeenCalledWith([
      { id: "pt-2", position: 1 },
      { id: "pt-1", position: 2 },
    ]);
  } finally {
    restoreRects();
  }
});

test("enter starts a keyboard drag", async () => {
  const user = userEvent.setup();
  const restoreRects = installRowRects();
  try {
    renderReorderList();
    const handle = dragHandle(1, "Alpha");
    handle.focus();

    await user.keyboard("{Enter}");

    expect(handle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/started dragging track "alpha"/i)).toBeTruthy();
  } finally {
    restoreRects();
  }
});

test("escape cancels a keyboard drag without reordering", async () => {
  const user = userEvent.setup();
  const restoreRects = installRowRects();
  try {
    const { onReorder } = renderReorderList();
    const handle = dragHandle(1, "Alpha");
    handle.focus();

    await user.keyboard("[Space]");
    expect(handle).toHaveAttribute("aria-pressed", "true");

    await flushKeyboardSensor();
    await user.keyboard("{Escape}");

    expect(handle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/drag operation cancelled/i)).toBeTruthy();
    expect(onReorder).not.toHaveBeenCalled();
  } finally {
    restoreRects();
  }
});

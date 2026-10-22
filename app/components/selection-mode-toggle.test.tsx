/**
 * @vitest-environment jsdom
 *
 * Selection Mode is read by two hook instances in the same tab: the switch
 * (`SelectionModeToggle`) and the library list. BroadcastChannel does not
 * deliver a message to the channel that posted it, so the list must still
 * update when this tab toggles the switch.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Checkbox } from "#app/components/ui/checkbox.tsx";
import {
  cleanupCuratorSync,
  initCuratorSync,
  type CuratorSyncMessage,
} from "#app/features/curator/sync.client.ts";
import { useSelection, useSelectionMode } from "#app/features/curator/selection.ts";
import { SelectionModeToggle } from "./selection-mode-toggle";
import { TrackListSelectionControls } from "./track-list-selection-controls";

const tracks = [
  { id: "track-1", title: "Song A" },
  { id: "track-2", title: "Song B" },
];

/**
 * Mirrors `/library`: the toggle owns one `useSelectionMode()` instance and
 * the list owns another. Checkboxes and bulk controls follow the list.
 */
function LibrarySelectionList() {
  const { selectionMode } = useSelectionMode();
  const { selectedTrackIds, selectedCount, toggleSelection, selectAll, deselectAll } =
    useSelection();

  return (
    <div>
      <SelectionModeToggle />
      {selectionMode ? (
        <TrackListSelectionControls
          selectedCount={selectedCount}
          totalCount={tracks.length}
          allSelected={selectedCount === tracks.length && tracks.length > 0}
          onSelectAll={() => selectAll(tracks.map((track) => track.id))}
          onDeselectAll={deselectAll}
          onBulkEdit={() => {}}
          isCurator
        />
      ) : null}
      <ul>
        {tracks.map((track) => (
          <li key={track.id}>
            <span>{track.title}</span>
            {selectionMode ? (
              <Checkbox
                checked={selectedTrackIds.has(track.id)}
                onCheckedChange={() => toggleSelection(track.id)}
                aria-label={`Select ${track.title}`}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

beforeEach(() => {
  localStorage.removeItem("curator:selection-mode");
  localStorage.removeItem("curator:selected-tracks");
  cleanupCuratorSync();
  initCuratorSync();
});

afterEach(() => {
  cleanupCuratorSync();
  localStorage.removeItem("curator:selection-mode");
  localStorage.removeItem("curator:selected-tracks");
});

test("turning selection mode on in this tab shows checkboxes and bulk controls", async () => {
  const user = userEvent.setup();
  render(<LibrarySelectionList />);

  expect(screen.getByRole("switch", { name: "Toggle selection mode" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Select Song A" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select All" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("switch", { name: "Toggle selection mode" }));

  expect(screen.getByRole("switch", { name: "Toggle selection mode" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select Song A" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select Song B" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Select All" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Deselect All" })).toBeInTheDocument();
});

test("turning selection mode off hides controls and clears the selection", async () => {
  const user = userEvent.setup();
  render(<LibrarySelectionList />);

  await user.click(screen.getByRole("switch", { name: "Toggle selection mode" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Song A" }));
  expect(screen.getByText("1 track selected")).toBeInTheDocument();

  await user.click(screen.getByRole("switch", { name: "Toggle selection mode" }));

  expect(screen.getByRole("switch", { name: "Toggle selection mode" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Select Song A" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select All" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("switch", { name: "Toggle selection mode" }));

  expect(screen.queryByText("1 track selected")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select Song A" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select Song B" })).not.toBeChecked();
});

test("other tabs still receive selection mode changes", async () => {
  const otherTab = new BroadcastChannel("curator-sync");
  const received = new Promise<CuratorSyncMessage>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("other tab received no message")), 1000);
    otherTab.onmessage = (event: MessageEvent<CuratorSyncMessage>) => {
      clearTimeout(timeout);
      resolve(event.data);
    };
  });

  try {
    const user = userEvent.setup();
    render(<LibrarySelectionList />);
    await user.click(screen.getByRole("switch", { name: "Toggle selection mode" }));
    await expect(received).resolves.toEqual({ type: "SELECTION_MODE_CHANGED", enabled: true });
  } finally {
    otherTab.close();
  }
});

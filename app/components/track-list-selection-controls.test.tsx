/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TrackListSelectionControls } from "./track-list-selection-controls";

describe("TrackListSelectionControls", () => {
  test("does not render for non-curators", () => {
    const { container } = render(
      <TrackListSelectionControls
        selectedCount={0}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("renders selection controls for curators", () => {
    render(
      <TrackListSelectionControls
        selectedCount={0}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    expect(screen.getByText("Select All")).toBeInTheDocument();
    expect(screen.getByText("Deselect All")).toBeInTheDocument();
  });

  test("shows selection count when tracks are selected", () => {
    render(
      <TrackListSelectionControls
        selectedCount={3}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    expect(screen.getByText("3 tracks selected")).toBeInTheDocument();
  });

  test("shows Bulk Edit button when 2+ tracks selected", () => {
    const { rerender } = render(
      <TrackListSelectionControls
        selectedCount={1}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    expect(screen.queryByText("Bulk Edit")).not.toBeInTheDocument();

    rerender(
      <TrackListSelectionControls
        selectedCount={2}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    expect(screen.getByText("Bulk Edit")).toBeInTheDocument();
  });

  test("calls onSelectAll when Select All is clicked", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();

    render(
      <TrackListSelectionControls
        selectedCount={0}
        totalCount={10}
        allSelected={false}
        onSelectAll={onSelectAll}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    await user.click(screen.getByText("Select All"));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  test("calls onDeselectAll when Deselect All is clicked", async () => {
    const user = userEvent.setup();
    const onDeselectAll = vi.fn();

    render(
      <TrackListSelectionControls
        selectedCount={5}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={onDeselectAll}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    await user.click(screen.getByText("Deselect All"));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
  });

  test("calls onBulkEdit when Bulk Edit button is clicked", async () => {
    const user = userEvent.setup();
    const onBulkEdit = vi.fn();

    render(
      <TrackListSelectionControls
        selectedCount={3}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={onBulkEdit}
        isCurator={true}
      />,
    );

    await user.click(screen.getByText("Bulk Edit"));
    expect(onBulkEdit).toHaveBeenCalledTimes(1);
  });

  test("disables Select All when all tracks are selected", () => {
    render(
      <TrackListSelectionControls
        selectedCount={10}
        totalCount={10}
        allSelected={true}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    const selectAllButton = screen.getByText("Select All");
    expect(selectAllButton).toBeDisabled();
  });

  test("disables Deselect All when no tracks are selected", () => {
    render(
      <TrackListSelectionControls
        selectedCount={0}
        totalCount={10}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onBulkEdit={vi.fn()}
        isCurator={true}
      />,
    );

    const deselectAllButton = screen.getByText("Deselect All");
    expect(deselectAllButton).toBeDisabled();
  });
});

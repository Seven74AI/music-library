/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { PromoteSnapshotDialog } from "./promote-snapshot-dialog";

const mockPromoteSubmit = vi.fn();

const mockPromoteFetcher = {
  state: "idle" as const,
  data: undefined as { status: string; message?: string; existingTitle?: string } | undefined,
  submit: mockPromoteSubmit,
};

const mockPlaylistsFetcher = {
  state: "idle" as const,
  data: undefined as { playlists: Array<{ id: string; title: string }> } | undefined,
  load: vi.fn(),
};

let fetcherIndex = 0;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => {
      const idx = fetcherIndex % 2;
      fetcherIndex += 1;
      if (idx === 0) return mockPromoteFetcher;
      return mockPlaylistsFetcher;
    },
  };
});

beforeEach(() => {
  consoleError.mockImplementation(() => {});
  fetcherIndex = 0;
  mockPromoteFetcher.state = "idle";
  mockPromoteFetcher.data = undefined;
  mockPlaylistsFetcher.state = "idle";
  mockPlaylistsFetcher.data = undefined;
  mockPlaylistsFetcher.load.mockReset();
  mockPromoteSubmit.mockReset();
});

test("replaces the previous snapshot title and creates a playlist for the new id", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <PromoteSnapshotDialog snapshotId="snap-jan" snapshotLabel="January 2026" />,
  );

  await user.click(screen.getByRole("button", { name: "Promote to playlist" }));
  await user.click(screen.getByRole("button", { name: "Create new playlist" }));
  expect(screen.getByPlaceholderText("Playlist name")).toHaveValue("January 2026");

  rerender(<PromoteSnapshotDialog snapshotId="snap-feb" snapshotLabel="February 2026" />);

  expect(screen.queryByDisplayValue("January 2026")).not.toBeInTheDocument();
  expect(screen.queryByText(/January 2026/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Promote to playlist" }));
  await user.click(screen.getByRole("button", { name: "Create new playlist" }));
  expect(screen.getByPlaceholderText("Playlist name")).toHaveValue("February 2026");

  await user.click(screen.getByRole("button", { name: "Create playlist" }));
  expect(mockPromoteSubmit).toHaveBeenCalledWith(
    { snapshotId: "snap-feb", action: "create", title: "February 2026" },
    { method: "POST", action: "/resources/promote-on-repeat-snapshot" },
  );
});

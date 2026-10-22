/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import {
  DuplicatePlaylistDialogProvider,
  useDuplicatePlaylistDialog,
} from "./duplicate-playlist-dialog";

const mockSubmit = vi.fn();
const mockRevalidate = vi.fn();

const mockFetcher = {
  state: "idle" as const,
  data: undefined as { status: string; message?: string; playlistId?: string } | undefined,
  submit: mockSubmit,
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => mockFetcher,
    useRevalidator: () => ({ revalidate: mockRevalidate }),
  };
});

beforeEach(() => {
  mockFetcher.state = "idle";
  mockFetcher.data = undefined;
  mockSubmit.mockReset();
  mockRevalidate.mockReset();
});

function TriggerButton() {
  const dialog = useDuplicatePlaylistDialog();
  return (
    <button
      type="button"
      onClick={() =>
        dialog?.requestConfirm({
          trackId: "track-1",
          trackTitle: "Test Song",
          playlist: { id: "playlist-1", title: "Favorites" },
        })
      }
    >
      Open confirm
    </button>
  );
}

function renderProvider() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <DuplicatePlaylistDialogProvider>
            <TriggerButton />
          </DuplicatePlaylistDialogProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

test("requestConfirm opens dialog with remove and add duplicate choices", async () => {
  const user = userEvent.setup();
  renderProvider();

  await user.click(screen.getByRole("button", { name: "Open confirm" }));

  expect(screen.getByRole("heading", { name: "Track already in playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Remove from Playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Add Duplicate" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
});

test("Remove from Playlist submits remove-track-from-playlist", async () => {
  const user = userEvent.setup();
  renderProvider();

  await user.click(screen.getByRole("button", { name: "Open confirm" }));
  await user.click(screen.getByRole("button", { name: "Remove from Playlist" }));

  expect(mockSubmit).toHaveBeenCalledWith(
    { trackId: "track-1", playlistId: "playlist-1" },
    { method: "POST", action: "/resources/remove-track-from-playlist" },
  );
});

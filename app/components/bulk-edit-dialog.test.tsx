/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { toast } from "#app/components/ui/use-toast.ts";
import { BulkEditDialog } from "./bulk-edit-dialog";

const mockSubmit = vi.fn();

const mockFetcher = {
  state: "idle" as "idle" | "submitting" | "loading",
  data: undefined as
    | {
        success?: boolean;
        updated?: number;
        updatedCount?: number;
        error?: string;
        errors?: Array<{ trackId: string; error: string }>;
      }
    | undefined,
  submit: mockSubmit,
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => mockFetcher,
  };
});

vi.mock("#app/components/artist-autocomplete", () => ({
  ArtistAutocomplete: () => <div>Artist</div>,
}));

vi.mock("#app/components/album-autocomplete", () => ({
  AlbumAutocomplete: ({
    onChange,
    label = "Album",
    disabled,
  }: {
    onChange: (albumId: string | null, albumName: string) => void;
    label?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange("album-blue", "Kind of Blue")}
    >
      {label}
    </button>
  ),
}));

vi.mock("#app/components/genre-selector", () => ({
  GenreSelector: ({
    onChange,
    label = "Genres",
    disabled,
  }: {
    onChange: (genres: Array<{ id: string; name: string; trackCount: number }>) => void;
    label?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange([{ id: "genre-jazz", name: "Jazz", trackCount: 3 }])}
    >
      {label}
    </button>
  ),
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

beforeEach(() => {
  mockFetcher.state = "idle";
  mockFetcher.data = undefined;
  mockSubmit.mockReset();
  vi.mocked(toast).mockReset();
});

function renderDialog(
  props: Partial<{
    trackIds: string[];
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <BulkEditDialog
            trackIds={props.trackIds ?? ["track-1", "track-2"]}
            open={props.open ?? true}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  return { ...render(<RouterProvider router={router} />), onClose, onSuccess };
}

test("submits JSON to the bulk-edit API instead of FormData", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.click(screen.getByRole("button", { name: "Genres" }));
  await user.type(screen.getByLabelText(/Bulk Edit Reason/), "Fix genre tags");
  await user.click(screen.getByRole("button", { name: /Apply to 2 Tracks/ }));

  expect(mockSubmit).toHaveBeenCalledTimes(1);
  const [payload, options] = mockSubmit.mock.calls[0] ?? [];

  expect(payload).not.toBeInstanceOf(FormData);
  expect(payload).toEqual({
    trackIds: ["track-1", "track-2"],
    changes: { genreIds: ["genre-jazz"] },
    comment: "Fix genre tags",
  });
  expect(options).toMatchObject({
    method: "POST",
    action: "/api/metadata/tracks/bulk-edit",
    encType: "application/json",
  });
});

test("sends the selected album id and not an album name", async () => {
  const user = userEvent.setup();
  renderDialog();

  const album = screen.getByRole("button", { name: "Album" });
  expect(album).toBeEnabled();
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();

  await user.click(album);
  await user.type(screen.getByLabelText(/Bulk Edit Reason/), "Assign album");
  await user.click(screen.getByRole("button", { name: /Apply to 2 Tracks/ }));

  const [payload] = mockSubmit.mock.calls[0] ?? [];
  expect(payload.changes).toEqual({ albumId: "album-blue" });
  expect(payload.changes).not.toHaveProperty("albumName");
});

test("leaves album unchanged when no album is selected", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.type(screen.getByLabelText("Year"), "1999");
  await user.type(screen.getByLabelText(/Bulk Edit Reason/), "Set year");
  await user.click(screen.getByRole("button", { name: /Apply to 2 Tracks/ }));

  const [payload] = mockSubmit.mock.calls[0] ?? [];
  expect(payload.changes).toEqual({ year: 1999 });
  expect(payload.changes).not.toHaveProperty("albumId");
  expect(payload.changes).not.toHaveProperty("albumName");
});

test("toasts using updatedCount from the API response", () => {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  mockFetcher.data = { success: true, updatedCount: 2 };

  renderDialog({ onSuccess, onClose });

  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Success",
      description: "2 track(s) updated successfully",
    }),
  );
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("shows an error toast when the API rejects the request", () => {
  mockFetcher.data = { error: "Invalid JSON body" };

  renderDialog();

  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Error",
      description: "Invalid JSON body",
      variant: "destructive",
    }),
  );
});

test("toasts validation failures and leaves the dialog open", () => {
  const onClose = vi.fn();
  mockFetcher.data = { error: "Validation failed" };

  renderDialog({ onClose });

  expect(screen.getByText(/Bulk Edit - 2 tracks selected/)).toBeInTheDocument();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Error",
      description: "Validation failed",
      variant: "destructive",
    }),
  );
  expect(onClose).not.toHaveBeenCalled();
});

test("toasts missing tracks and leaves the dialog open", () => {
  const onClose = vi.fn();
  mockFetcher.data = { error: "Some tracks not found" };

  renderDialog({ onClose });

  expect(screen.getByText(/Bulk Edit - 2 tracks selected/)).toBeInTheDocument();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Error",
      description: "Some tracks not found",
      variant: "destructive",
    }),
  );
  expect(onClose).not.toHaveBeenCalled();
});

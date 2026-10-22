/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { TrackDetailsDialog } from "./track-details-dialog";

const { toastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(() => ({
    id: "toast-1",
    dismiss: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: toastMock,
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock("#app/hooks/use-lock", () => ({
  useLock: () => ({
    lock: null,
    isLocked: false,
    isLockedByOther: false,
    isLoading: false,
    error: null,
    acquire: vi.fn(),
    release: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("#app/components/artist-autocomplete", () => ({
  ArtistAutocomplete: () => <div>Artist field</div>,
}));

vi.mock("#app/components/genre-selector", () => ({
  GenreSelector: () => <div>Genre field</div>,
}));

const track = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
  albumRecord: null,
  duration: 180,
  createdAt: "2025-01-01T00:00:00.000Z",
  releaseDate: null,
  originalDate: null,
  coverImage: null,
  service: null,
  serviceUrl: null,
  genre: null,
  genres: [] as Array<{ id: string; name: string }>,
  year: null,
  trackNumber: null,
  albumArtist: null,
  bpm: null,
  label: null,
  isrc: null,
  originalYear: null,
  totalTracks: null,
  totalDiscs: null,
  lyrics: null,
};

type Submission = {
  contentType: string | null;
  body: unknown;
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  toastMock.mockClear();
  toastMock.mockImplementation(() => ({
    id: "toast-1",
    dismiss: vi.fn(),
    update: vi.fn(),
  }));
});

async function readSubmission(request: Request): Promise<Submission> {
  const contentType = request.headers.get("content-type");
  const raw = await request.text();
  try {
    return { contentType, body: JSON.parse(raw) as unknown };
  } catch {
    return { contentType, body: raw };
  }
}

test("submits a track edit as JSON and a successful save does not throw", async () => {
  const user = userEvent.setup();
  let submission: Submission | null = null;
  const edit = deferred<{ edit: { id: string } }>();

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <TrackDetailsDialog trackId="track-1" open onOpenChange={vi.fn()} />,
      },
      {
        path: "/resources/track-details",
        loader: () => ({
          track,
          isCurator: true,
          notesCount: 0,
          currentUserId: "user-1",
        }),
      },
      {
        path: "/api/metadata/tracks/:trackId/edit",
        action: async ({ request }) => {
          submission = await readSubmission(request);
          return edit.promise;
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  const title = await screen.findByLabelText(/Title/);
  await user.clear(title);
  await user.type(title, "Updated Title");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await user.type(screen.getByLabelText(/^Comment/), "Correct the title");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(submission).not.toBeNull();
  });

  expect(submission!.contentType).toContain("application/json");
  expect(submission!.body).toEqual(
    expect.objectContaining({
      title: "Updated Title",
      artistId: "artist-1",
      genreIds: [],
      comment: "Correct the title",
    }),
  );
  expect(toastMock).not.toHaveBeenCalled();
  expect(screen.queryByText(/Application Error/i)).toBeNull();
  expect(router.state.location.pathname).toBe("/");

  edit.resolve({ edit: { id: "edit-1" } });

  await waitFor(() => {
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Changes saved successfully" }),
    );
  });
  expect(await screen.findByText("Test Song")).toBeTruthy();
  expect(screen.queryByText(/Application Error/i)).toBeNull();
  expect(router.state.location.pathname).toBe("/");
});

test("submits a track restore as JSON", async () => {
  const user = userEvent.setup();
  let submission: Submission | null = null;

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <TrackDetailsDialog trackId="track-1" open onOpenChange={vi.fn()} />,
      },
      {
        path: "/resources/track-details",
        loader: () => ({
          track,
          isCurator: true,
          notesCount: 0,
          currentUserId: "user-1",
        }),
      },
      {
        path: "/api/metadata/tracks/:trackId/history",
        loader: () => ({
          history: [
            {
              id: "edit-new",
              editedAt: "2025-06-01T00:00:00.000Z",
              editedBy: { id: "user-1", username: "kody", name: "Kody" },
              comment: "Latest",
              changes: { title: { from: "Old", to: "Test Song" } },
            },
            {
              id: "edit-old",
              editedAt: "2025-01-01T00:00:00.000Z",
              editedBy: { id: "user-1", username: "kody", name: "Kody" },
              comment: "Original",
              changes: { title: { from: null, to: "Old" } },
            },
          ],
        }),
      },
      {
        path: "/api/metadata/tracks/:trackId/restore/:editId",
        action: async ({ request, params }) => {
          submission = await readSubmission(request);
          submission.body = { ...(submission.body as object), editId: params.editId };
          return { edit: { id: "edit-restored" } };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await screen.findByLabelText(/Title/);
  await user.click(screen.getByRole("tab", { name: "History" }));
  await user.click(await screen.findByRole("button", { name: "Restore" }));
  await user.type(screen.getByLabelText(/^Comment/), "Reverting a bad edit");
  await user.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(submission).not.toBeNull();
  });

  expect(submission!.contentType).toContain("application/json");
  expect(submission!.body).toEqual({
    comment: "Reverting a bad edit",
    editId: "edit-old",
  });
  expect(screen.queryByText(/Application Error/i)).toBeNull();
  expect(router.state.location.pathname).toBe("/");
});

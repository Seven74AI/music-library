/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { TrackDetailsDialog } from "./track-details-dialog";

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

const mockLoad = vi.fn();
let fetcherState: "idle" | "loading" = "idle";
let fetcherData:
  | {
      track: unknown;
      isCurator?: boolean;
      notesCount?: number;
      currentUserId?: string;
    }
  | undefined = undefined;

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      get state() {
        return fetcherState;
      },
      get data() {
        return fetcherData;
      },
      load: mockLoad,
      submit: vi.fn(),
    }),
  };
});

beforeEach(() => {
  mockLoad.mockReset();
  fetcherState = "idle";
  fetcherData = undefined;
});

const curatorTrack = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
  albumRecord: null,
  duration: 180,
  createdAt: "2025-01-01T00:00:00.000Z",
  releaseDate: null,
  originalDate: null,
  coverImage: null,
  service: { displayName: "YouTube" },
  serviceUrl: null,
  genre: null,
  genres: [],
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

function renderDialog(
  open = false,
  props: { initialTab?: "basic" | "extended" | "history" | "notes" } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <TrackDetailsDialog trackId="track-1" open={open} onOpenChange={vi.fn()} {...props} />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

test("does not fetch when closed", () => {
  renderDialog(false);
  expect(mockLoad).not.toHaveBeenCalled();
});

test("fetches track details when opened", () => {
  renderDialog(true);
  expect(mockLoad).toHaveBeenCalledWith("/resources/track-details?trackId=track-1");
});

test("stacks the dialog above the now-playing sheet", () => {
  renderDialog(true);

  const dialog = screen.getByRole("dialog");
  expect(dialog.className).toMatch(/\bz-\[80\]/);
  expect(dialog.className).not.toMatch(/\bz-53\b/);

  const overlay = document.querySelector("[data-testid='track-details-overlay']");
  expect(overlay).toBeTruthy();
  expect(overlay?.className).toMatch(/\bz-\[80\]/);
  expect(overlay?.className).not.toMatch(/\bz-53\b/);
});

test("shows loading spinner while fetching", () => {
  fetcherState = "loading";
  renderDialog(true);

  const spinner = document.querySelector(".animate-spin");
  expect(spinner).toBeTruthy();
});

test("shows track details when loaded", () => {
  fetcherData = {
    track: {
      id: "track-1",
      title: "Test Song",
      artist: { id: "artist-1", name: "Test Artist" },
      duration: 180,
      createdAt: "2025-01-01T00:00:00.000Z",
      releaseDate: "2009-10-25T06:57:33.000Z",
      originalDate: null,
      coverImage: { objectKey: "covers/test.jpg" },
      service: { displayName: "YouTube" },
      serviceUrl: "https://youtube.com/watch?v=abc",
      genres: [],
      albumRecord: null,
    },
  };

  renderDialog(true);

  expect(screen.getByText("Test Song")).toBeDefined();
  expect(screen.getByText("Test Artist")).toBeDefined();
  // Duration is formatted
  expect(screen.getByText("Duration: 3:00")).toBeDefined();
  expect(screen.getByText("Source: YouTube")).toBeDefined();
  expect(
    screen.getByText(`Date added: ${new Date("2009-10-25T06:57:33.000Z").toLocaleDateString()}`),
  ).toBeDefined();
});

test("shows Open on YouTube button when serviceUrl is present", () => {
  fetcherData = {
    track: {
      id: "track-1",
      title: "Test",
      artist: { id: "a", name: "A" },
      duration: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      coverImage: null,
      service: null,
      serviceUrl: "https://youtube.com/watch?v=abc",
      genres: [],
      albumRecord: null,
    },
  };

  renderDialog(true);

  expect(screen.getByText("Open on YouTube")).toBeDefined();
});

test("opens the notes tab for curators when initialTab is notes", () => {
  fetcherData = {
    track: curatorTrack,
    isCurator: true,
    notesCount: 2,
    currentUserId: "user-1",
  };

  renderDialog(true, { initialTab: "notes" });

  expect(screen.getByRole("tab", { name: /notes/i }).getAttribute("data-state")).toBe("active");
  expect(screen.getByText("Add a note")).toBeDefined();
});

test("keeps curators on the basic tab when no initial tab is requested", () => {
  fetcherData = {
    track: curatorTrack,
    isCurator: true,
    notesCount: 2,
    currentUserId: "user-1",
  };

  renderDialog(true);

  expect(screen.getByRole("tab", { name: "Basic" }).getAttribute("data-state")).toBe("active");
});

function curatorPayload(id: string, title: string, artistName: string) {
  return {
    track: {
      ...curatorTrack,
      id,
      title,
      artist: { id: `artist-${id}`, name: artistName },
    },
    isCurator: true,
    notesCount: 0,
    currentUserId: "user-1",
  };
}

test("loads the next track instead of keeping the previous track in the editor", async () => {
  fetcherData = curatorPayload("track-1", "First Title", "First Artist");
  let updateTrackId = (_trackId: string) => {};
  let refresh = () => {};

  function Harness() {
    const [trackId, setTrackId] = useState("track-1");
    const [, bump] = useState(0);
    updateTrackId = setTrackId;
    refresh = () => bump((count) => count + 1);
    return <TrackDetailsDialog trackId={trackId} open onOpenChange={vi.fn()} />;
  }

  const router = createMemoryRouter([{ path: "/", element: <Harness /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);

  expect(screen.getByDisplayValue("First Title")).toBeDefined();
  expect(screen.getByDisplayValue("First Artist")).toBeDefined();
  expect(mockLoad).not.toHaveBeenCalled();

  await act(async () => {
    updateTrackId("track-2");
  });

  expect(mockLoad).toHaveBeenCalledWith("/resources/track-details?trackId=track-2");
  expect(screen.queryByText("First Title")).toBeNull();
  expect(screen.queryByDisplayValue("First Title")).toBeNull();
  expect(screen.queryByDisplayValue("First Artist")).toBeNull();

  fetcherData = curatorPayload("track-2", "Second Title", "Second Artist");
  await act(async () => {
    refresh();
  });

  expect(screen.getByDisplayValue("Second Title")).toBeDefined();
  expect(screen.getByDisplayValue("Second Artist")).toBeDefined();
});

test("does not show YouTube button when serviceUrl is null", () => {
  fetcherData = {
    track: {
      id: "track-1",
      title: "Test",
      artist: { id: "a", name: "A" },
      duration: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      coverImage: null,
      service: null,
      serviceUrl: null,
      genres: [],
      albumRecord: null,
    },
  };

  renderDialog(true);

  expect(screen.queryByText("Open on YouTube")).toBeNull();
});

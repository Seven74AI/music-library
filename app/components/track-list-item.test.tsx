/**
 * @vitest-environment jsdom
 *
 * TrackListItem UI tests. Queue action *behavior* (order, queue sheet visibility) lives in
 * audio-player-queue.integration.test.tsx — these tests only cover menu wiring and visibility.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type FullTrack } from "#app/types/frontend/shared";
import { TrackListItem } from "./track-list-item";

type MockUser = {
  id: string;
  roles: Array<{
    name: string;
    permissions: Array<{ action: string; entity: string; access: string }>;
  }>;
};

const signedInListener: MockUser = {
  id: "user-1",
  roles: [{ name: "user", permissions: [] }],
};

const userState = vi.hoisted(() => ({
  current: undefined as MockUser | null | undefined,
}));

const { mockSubmit } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
}));

vi.mock("#app/utils/user.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/user.ts")>();
  return {
    ...actual,
    useOptionalUser: () => userState.current,
  };
});

const mockPlayTrack = vi.fn();
const mockPlayNextTrack = vi.fn();
const mockAddToUpNext = vi.fn();
const mockAddToQueue = vi.fn();
const mockToast = vi.fn();

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      submit: mockSubmit,
    }),
  };
});

let mockPlayerState: {
  currentTrack: FullTrack | null;
  currentIndex: number;
  isPlayerVisible: boolean;
} = {
  currentTrack: null,
  currentIndex: 0,
  isPlayerVisible: false,
};

vi.mock("./audio-player-provider", () => ({
  AudioPlayerProvider: ({ children }: { children: ReactNode }) => children,
  useAudioPlayer: () => ({
    currentTrack: mockPlayerState.currentTrack,
    currentIndex: mockPlayerState.currentIndex,
    isPlayerVisible: mockPlayerState.isPlayerVisible,
    playTrack: mockPlayTrack,
    playNextTrack: mockPlayNextTrack,
    addToUpNext: mockAddToUpNext,
    addToQueue: mockAddToQueue,
  }),
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

let mockIsMobile = false;
vi.mock("#app/utils/use-mobile.ts", () => ({
  useIsMobile: () => mockIsMobile,
}));

vi.mock("./track-details-dialog", () => ({
  TrackDetailsDialog: ({
    trackId,
    open,
    initialTab,
  }: {
    trackId: string;
    open: boolean;
    initialTab?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      initialTab === "notes" ? (
        <div role="dialog" aria-label={`Notes for ${trackId} on ${initialTab}`} />
      ) : (
        <div role="dialog" aria-label="Curator track details">
          <span>editor for {trackId}</span>
          <div role="tablist">
            <button type="button" role="tab">
              Basic
            </button>
            <button type="button" role="tab">
              Extended
            </button>
            <button type="button" role="tab">
              History
            </button>
            <button type="button" role="tab">
              Notes
            </button>
          </div>
        </div>
      )
    ) : null,
}));

vi.mock("./add-to-playlist-menu", () => ({
  AddToPlaylistMenu: ({ playlists }: { playlists?: Array<{ id: string; title: string }> }) => (
    <div data-testid="add-to-playlist-menu">
      {playlists?.map((playlist) => (
        <div key={playlist.id}>{playlist.title}</div>
      ))}
    </div>
  ),
}));

// jsdom doesn't implement matchMedia — stub it so useIsMobile() works
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const mockTrack = {
  id: "track-1",
  title: "Test Song",
  artist: { id: "artist-1", name: "Test Artist" },
  duration: 180,
  coverImage: null,
  thumbnailUrl: null,
  serviceUrl: "https://youtube.com/watch?v=test",
  service: { displayName: "YouTube", logoUrl: null },
  audioFiles: [],
  isInUserLibrary: true,
};

const playableTrack = {
  ...mockTrack,
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/test.mp3" }],
};

const mockUserTrack = {
  createdAt: new Date("2024-01-01").toISOString(),
};

function renderTrackListItem(props: Partial<ComponentProps<typeof TrackListItem>> = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <TrackListItem track={mockTrack} userTrack={mockUserTrack} index={0} {...props} />,
      },
      { path: "/albums/:albumId", element: <div>Album page</div> },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function userWithRole(name: string): MockUser {
  return { id: `${name}-1`, roles: [{ name, permissions: [] }] };
}

beforeEach(() => {
  userState.current = signedInListener;
  // The read-only details dialog stubs focus to avoid a jsdom focus loop, and
  // Radix can leave <body> with pointer-events: none after that dialog closes.
  document.body.style.pointerEvents = "auto";
  document.body.style.overflow = "";
  document.body.removeAttribute("data-scroll-locked");
  mockIsMobile = false;
  mockSubmit.mockReset();
  mockPlayerState = {
    currentTrack: null,
    currentIndex: 0,
    isPlayerVisible: false,
  };
  mockPlayTrack.mockReset();
  mockPlayNextTrack.mockReset();
  mockAddToUpNext.mockReset();
  mockAddToQueue.mockReset();
  mockToast.mockReset();
});

test("shows Archiving when the track has no audio", () => {
  renderTrackListItem();

  expect(screen.getByText("Archiving")).toBeDefined();
});

test("hides Archiving when the missing audio is a deleted video", () => {
  renderTrackListItem({ isDeleted: true });

  expect(screen.queryByText("Archiving")).toBeNull();
  expect(screen.getByText(/Deleted from YouTube/)).toBeDefined();
});

test("shows the album under the artist without starting playback", async () => {
  const user = userEvent.setup();
  renderTrackListItem({
    track: {
      ...playableTrack,
      album: { id: "album-1", name: "Test Album" },
    },
  });

  await user.click(screen.getByRole("link", { name: "Test Album" }));

  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("adds an unsaved track to the library", async () => {
  const user = userEvent.setup();
  renderTrackListItem({
    track: { ...playableTrack, isInUserLibrary: false },
    showAddToLibrary: true,
  });

  await user.click(screen.getByRole("button", { name: "Add to library" }));

  expect(mockSubmit).toHaveBeenCalledWith(
    { trackId: "track-1", action: "add" },
    { method: "post", action: "/resources/track-library" },
  );
  expect(mockPlayTrack).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add to library" })).toBeNull();
});

test("hides add to library when the track is already saved", () => {
  renderTrackListItem({
    track: { ...playableTrack, isInUserLibrary: true },
    showAddToLibrary: true,
  });

  expect(screen.queryByRole("button", { name: "Add to library" })).toBeNull();
});

test("renders itemActions render prop when provided", () => {
  renderTrackListItem({
    itemActions: ({ trackId, isInLibrary, isDeleted }) => (
      <span data-testid="custom-action">
        {trackId}-{isInLibrary ? "lib" : "nolib"}-{isDeleted ? "del" : "ok"}
      </span>
    ),
  });

  const el = screen.getByTestId("custom-action");
  expect(el).toBeDefined();
  expect(el.textContent).toBe("track-1-lib-ok");
});

test("itemActions receives correct props when track is deleted", () => {
  let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null;

  renderTrackListItem({
    track: { ...mockTrack, isInUserLibrary: false },
    index: 2,
    isDeleted: true,
    itemActions: (props) => {
      captured = props;
      return <span data-testid="deleted-action">deleted</span>;
    },
  });

  expect(screen.getByTestId("deleted-action")).toBeDefined();
  expect(captured).toEqual({
    trackId: "track-1",
    isInLibrary: false,
    isDeleted: true,
  });
});

test("itemActions receives correct props when isInUserLibrary is undefined", () => {
  let captured: { trackId: string; isInLibrary: boolean; isDeleted: boolean } | null = null;

  renderTrackListItem({
    track: { ...mockTrack, isInUserLibrary: undefined },
    itemActions: (props) => {
      captured = props;
      return <span data-testid="nolib-action">nolib</span>;
    },
  });

  expect(screen.getByTestId("nolib-action")).toBeDefined();
  expect(captured!.isInLibrary).toBe(false);
  expect(captured!.isDeleted).toBe(false);
});

test("does not render itemActions when not provided", () => {
  renderTrackListItem();

  // Track title should still render
  expect(screen.getByText("Test Song")).toBeDefined();
  // No data-testid elements from our render prop
  expect(screen.queryByTestId("custom-action")).toBeNull();
});

test("shows Add to Playlist when playlists is an empty array", async () => {
  const user = userEvent.setup();

  renderTrackListItem({ playlists: [] });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByText("Add to Playlist")).toBeDefined();
});

test("hides queue actions when track has no audio files", async () => {
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.queryByText("Play next")).toBeNull();
  expect(screen.queryByText("Add to up next")).toBeNull();
  expect(screen.queryByText("Add to queue")).toBeNull();
});

test("shows queue actions when track has audio files", async () => {
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByText("Play next")).toBeDefined();
  expect(screen.getByText("Add to up next")).toBeDefined();
  expect(screen.getByText("Add to queue")).toBeDefined();
});

test("mobile more-actions button opens sheet without starting playback", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack });

  await user.click(screen.getByRole("button", { name: "More actions" }));

  expect(screen.getByText("View track details")).toBeDefined();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("mobile actions sheet Play next does not start row playback", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByText("Play next"));

  expect(mockPlayNextTrack).toHaveBeenCalled();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("mobile actions sheet overlay dismiss does not start playback", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByText("View track details")).toBeDefined();

  // Portaled overlay click must not React-bubble into the row's onClick=play
  // (sheets are siblings of the row for this reason — see track-list-item.tsx).
  const overlay = document.querySelector(".fixed.inset-0.z-53");
  expect(overlay).not.toBeNull();
  await user.click(overlay!);

  expect(screen.queryByText("View track details")).toBeNull();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("compact variant hides track number column", () => {
  renderTrackListItem({ variant: "compact", index: 4 });

  expect(screen.queryByLabelText("Track number 5")).toBeNull();
  expect(screen.getByText("Test Song")).toBeDefined();
});

test("showQuickAddToPlaylist renders add button and opens playlist menu on desktop", async () => {
  const user = userEvent.setup();

  renderTrackListItem({
    showQuickAddToPlaylist: true,
    playlists: [{ id: "pl-1", title: "My Playlist", description: null, _count: { tracks: 1 } }],
  });

  await user.click(screen.getByRole("button", { name: "Add to playlist" }));
  expect(screen.getByText("My Playlist")).toBeDefined();
});

test("signed-in user sees Report Issue in the desktop overflow menu", async () => {
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Report Issue" })).toBeDefined();
});

test("signed-in user sees Report Issue in the mobile actions sheet", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("button", { name: "Report Issue" }));
  expect(await screen.findByRole("dialog", { name: "Report Issue" })).toBeDefined();
  expect(screen.getByText(/Report a problem with "Test Song"/)).toBeDefined();
});

test("signed-out user does not see Report Issue", async () => {
  userState.current = undefined;
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.queryByRole("menuitem", { name: "Report Issue" })).toBeNull();
});

test("submitting Report Issue posts trackId, issueType, and description", async () => {
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Report Issue" }));
  expect(await screen.findByRole("dialog", { name: "Report Issue" })).toBeDefined();

  const issueType = document.querySelector("select");
  if (!(issueType instanceof HTMLSelectElement)) {
    throw new Error("Expected the report issue type select");
  }
  await user.selectOptions(issueType, "wrong_metadata");
  await user.type(screen.getByLabelText(/description/i), "The artist name is wrong");
  await user.click(screen.getByRole("button", { name: "Submit Report" }));

  expect(mockSubmit).toHaveBeenCalledTimes(1);
  const [formData, options] = mockSubmit.mock.calls[0] as [
    FormData,
    { method: string; action: string },
  ];
  expect(Object.fromEntries(formData.entries())).toEqual({
    trackId: "track-1",
    issueType: "wrong_metadata",
    description: "The artist name is wrong",
  });
  expect(options).toEqual({ method: "POST", action: "/api/curator/queue/report" });
});

test("hides Flag for review from listeners on the desktop overflow menu", async () => {
  userState.current = userWithRole("user");
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.queryByRole("menuitem", { name: /flag for review/i })).toBeNull();
});

test("hides Flag for review when signed out", async () => {
  userState.current = undefined;
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.queryByRole("menuitem", { name: /flag for review/i })).toBeNull();
});

test("curator can open Flag for review from the desktop overflow menu", async () => {
  userState.current = userWithRole("curator");
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: /flag for review/i }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Flag for Review" })).toBeDefined();
  expect(within(dialog).getByText(/Test Song/)).toBeDefined();
});

test("admin can open Flag for review from the desktop overflow menu", async () => {
  userState.current = userWithRole("admin");
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: /flag for review/i })).toBeDefined();
});

test("curator can open Flag for review from the mobile actions sheet", async () => {
  mockIsMobile = true;
  userState.current = userWithRole("curator");
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("button", { name: /flag for review/i }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Flag for Review" })).toBeDefined();
  expect(within(dialog).getByText(/Test Song/)).toBeDefined();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("mobile actions sheet hides Flag for review from listeners", async () => {
  mockIsMobile = true;
  userState.current = userWithRole("user");
  const user = userEvent.setup();

  renderTrackListItem();

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.queryByRole("button", { name: /flag for review/i })).toBeNull();
});

test("hides the notes badge when the track has no curator notes", () => {
  renderTrackListItem({ track: playableTrack, curatorNotesCount: 0 });

  expect(screen.queryByTitle("0 notes")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("shows the notes badge when the track has curator notes", () => {
  renderTrackListItem({ track: playableTrack, curatorNotesCount: 2 });

  expect(screen.getByTitle("2 notes")).toBeDefined();
  expect(screen.getByText("2")).toBeDefined();
});

test("clicking the notes badge opens track notes without starting playback", async () => {
  const user = userEvent.setup();
  renderTrackListItem({ track: playableTrack, curatorNotesCount: 1 });

  await user.click(screen.getByTitle("1 note"));

  expect(screen.getByRole("dialog", { name: "Notes for track-1 on notes" })).toBeDefined();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("non-curator desktop row menu keeps the read-only track details view", async () => {
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack });

  await user.click(screen.getByRole("button", { name: "More actions" }));

  // Radix dialog focus scope recurses in jsdom when opened from a dropdown.
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = () => {};
  try {
    await user.click(screen.getByRole("menuitem", { name: "View track details" }));

    expect(screen.getByText("Track Information")).toBeDefined();
    expect(screen.getByText("Artist: Test Artist")).toBeDefined();
    expect(screen.getByText(/Duration:/)).toBeDefined();
    expect(screen.queryByText(/^Added:/)).toBeNull();
    expect(screen.queryByRole("tab", { name: "Basic" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Curator track details" })).toBeNull();
    expect(mockPlayTrack).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.focus = originalFocus;
  }
});

test("non-curator mobile row menu keeps the read-only track details sheet", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack, isCurator: false });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("button", { name: "View track details" }));

  expect(screen.getByText("Track Information")).toBeDefined();
  expect(screen.getByText("Artist: Test Artist")).toBeDefined();
  expect(screen.queryByRole("tab", { name: "Basic" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Curator track details" })).toBeNull();
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("curator desktop row menu opens TrackDetailsDialog without playing", async () => {
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack, isCurator: true });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("menuitem", { name: "View track details" }));

  expect(screen.getByRole("dialog", { name: "Curator track details" })).toBeDefined();
  expect(screen.getByText("editor for track-1")).toBeDefined();
  expect(screen.getByRole("tab", { name: "Basic" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "Extended" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "History" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "Notes" })).toBeDefined();
  expect(screen.queryByText("Track Information")).toBeNull();
  expect(mockPlayTrack).not.toHaveBeenCalled();

  await user.click(screen.getByRole("tab", { name: "Extended" }));
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("curator mobile row menu opens TrackDetailsDialog without playing", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({ track: playableTrack, isCurator: true });

  await user.click(screen.getByRole("button", { name: "More actions" }));
  await user.click(screen.getByRole("button", { name: "View track details" }));

  expect(screen.getByRole("dialog", { name: "Curator track details" })).toBeDefined();
  expect(screen.getByText("editor for track-1")).toBeDefined();
  expect(screen.getByRole("tab", { name: "Basic" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "Extended" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "History" })).toBeDefined();
  expect(screen.getByRole("tab", { name: "Notes" })).toBeDefined();
  expect(screen.queryByText("Track Information")).toBeNull();
  expect(mockPlayTrack).not.toHaveBeenCalled();

  await user.click(screen.getByRole("tab", { name: "Notes" }));
  expect(mockPlayTrack).not.toHaveBeenCalled();
});

test("mobile actions sheet scrolls inside a bounded flex column", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({
    track: playableTrack,
    playlists: [],
    showAudioFileDownload: true,
  });

  await user.click(screen.getByRole("button", { name: "More actions" }));

  const sheet = screen.getByTestId("track-actions-sheet");
  expect(sheet.className).toContain("flex");
  expect(sheet.className).toContain("flex-col");
  expect(sheet.className).toContain("h-[60vh]");
  expect(sheet.className).toContain("overflow-hidden");

  const scroller = screen.getByTestId("track-actions-scroll");
  expect(scroller.className).toContain("min-h-0");
  expect(scroller.className).toContain("overflow-y-auto");
  expect(sheet.contains(scroller)).toBe(true);
  for (const name of ["Add to up next", "Add to queue", "Download"]) {
    expect(scroller.contains(screen.getByRole("button", { name }))).toBe(true);
  }

  await user.click(screen.getByRole("button", { name: "Add to Playlist" }));

  const playlistSheet = document.querySelector(".h-\\[80vh\\]");
  expect(playlistSheet).not.toBeNull();
  expect(playlistSheet!.className).not.toContain("overflow-y-auto");
  expect(playlistSheet!.querySelector("[data-testid='track-actions-scroll']")).toBeNull();
});

test("showQuickAddToPlaylist opens playlist sheet directly on mobile", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();

  renderTrackListItem({
    showQuickAddToPlaylist: true,
    playlists: [{ id: "pl-1", title: "My Playlist", description: null, _count: { tracks: 1 } }],
  });

  await user.click(screen.getByRole("button", { name: "Add to playlist" }));
  expect(screen.getByRole("heading", { name: "Add to Playlist" })).toBeDefined();
  expect(screen.getByText("My Playlist")).toBeDefined();
});

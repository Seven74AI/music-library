/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GotACodeJoin } from "#app/components/party-room/got-a-code-join.tsx";
import { GuestRoomLivePanel } from "#app/components/party-room/guest-room-live-panel.tsx";
import { InRoomChip } from "#app/components/party-room/in-room-chip.tsx";
import { HostFailoverControls } from "#app/components/party-room/host-failover-controls.tsx";
import { AddToRoomQueueAction } from "#app/components/party-room/add-to-room-queue-action.tsx";
import { RoomQueuePanel } from "#app/components/party-room/room-queue-panel.tsx";
import { RoomsHub } from "#app/components/party-room/rooms-hub.tsx";

const join = vi.fn();
const becomeHostNow = vi.fn();
const reclaimHostNow = vi.fn();
const addTrack = vi.fn();
const addPlaylist = vi.fn();
const reorderUpcoming = vi.fn();
const setRole = vi.fn();
const kick = vi.fn();
const end = vi.fn();
const leave = vi.fn();

const queueItem = (id: string, position: number, title: string) => ({
  id,
  position,
  trackId: `track-${id}`,
  track: {
    id: `track-${id}`,
    title,
    artistName: "Artist",
    duration: 180,
    coverObjectKey: null,
    hasAudio: true,
  },
  addedByParticipantId: "p1",
  addedByDisplayName: "Host",
  createdAt: new Date().toISOString(),
});

const baseParty = {
  room: null as null | Record<string, unknown>,
  loading: false,
  error: null as string | null,
  apiUnavailable: false,
  isHost: false,
  canAddTracks: false,
  canTransport: false,
  canManage: false,
  showBecomeHost: false,
  showReclaimHost: false,
  refresh: vi.fn(),
  create: vi.fn(),
  join,
  leave,
  end,
  becomeHostNow,
  reclaimHostNow,
  setDefaultJoinRole: vi.fn(),
  addTrack,
  addPlaylist,
  reorderUpcoming,
  setRole,
  kick,
  transport: vi.fn(),
  clearError: vi.fn(),
};

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
  usePartyRoom: () => mockParty,
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

let mockParty = { ...baseParty };

function renderWithRouter(ui: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: "/", element: ui },
      { path: "/rooms/:code", element: <p>Opened room</p> },
    ],
    { initialEntries: ["/"] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

function seat(
  partial: { id: string; displayName: string; role: "host" | "dj" | "listener" } & Record<
    string,
    unknown
  >,
) {
  return {
    userId: null,
    isGuest: false,
    lastHeartbeatAt: null,
    isOriginalHost: false,
    ...partial,
  };
}

function renderOpenHub({
  role,
  isOriginalHost = role === "host",
  meId = "p1",
  displayName = "Kody",
  participants,
}: {
  role: "host" | "dj" | "listener";
  isOriginalHost?: boolean;
  meId?: string;
  displayName?: string;
  participants?: Array<Record<string, unknown>>;
}) {
  if (role === "host") {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ playlists: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  const me = seat({
    id: meId,
    displayName,
    role,
    userId: "u1",
    isOriginalHost,
  });
  mockParty = {
    ...mockParty,
    canManage: role === "host",
    isHost: role === "host",
    end,
    leave,
    room: {
      id: "r1",
      code: "AB3K9Q",
      status: "open",
      roomVersion: 1,
      defaultJoinRole: "listener",
      me,
      participants: participants ?? [me],
      queue: [],
      playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      joinUrl: "/rooms/AB3K9Q",
      qrDataUrl: null,
    },
  };
  return renderWithRouter(<RoomsHub />);
}

function openEndRoomConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^end room$/i }));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent(/everyone will be disconnected/i);
  expect(dialog).toHaveTextContent(/code will stop working/i);
  expect(end).not.toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
  return dialog;
}

function renderQueuePanel({
  role = "host",
  isHost = role === "host",
  canTransport = role === "host",
  canManage = role === "host",
  queue = [],
  isPlaying = false,
  currentIndex = 0,
  currentTrackId = null,
}: {
  role?: "host" | "dj" | "listener";
  isHost?: boolean;
  canTransport?: boolean;
  canManage?: boolean;
  queue?: ReturnType<typeof queueItem>[];
  isPlaying?: boolean;
  currentIndex?: number;
  currentTrackId?: string | null;
} = {}) {
  mockParty = {
    ...mockParty,
    isHost,
    canTransport,
    canManage,
    room: {
      id: "r1",
      code: "AB3K9Q",
      status: "open",
      roomVersion: 1,
      me: { id: "p1", role, userId: "u1" },
      queue,
      playback: { isPlaying, currentIndex, currentTrackId },
    },
  };
  return renderWithRouter(<RoomQueuePanel />);
}

describe("Party Room UI affordances", () => {
  beforeEach(() => {
    mockParty = {
      ...baseParty,
      room: null,
      join,
      becomeHostNow,
      reclaimHostNow,
      addTrack,
      addPlaylist,
      reorderUpcoming,
      setRole,
      kick,
    };
    join.mockReset();
    becomeHostNow.mockReset();
    reclaimHostNow.mockReset();
    addTrack.mockReset();
    addPlaylist.mockReset();
    reorderUpcoming.mockReset();
    setRole.mockReset();
    kick.mockReset();
    end.mockReset();
    leave.mockReset();
  });

  it("renders Got a code? join form when not in a room", () => {
    renderWithRouter(<GotACodeJoin />);
    expect(screen.getByRole("heading", { name: /got a code/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code or join link/i)).toBeInTheDocument();
  });

  it("joins with a normalized code from the home form", async () => {
    join.mockResolvedValue({ code: "AB3K9Q" });
    const { router } = renderWithRouter(<GotACodeJoin />);
    fireEvent.change(screen.getByLabelText(/room code or join link/i), {
      target: { value: "ab3k9q" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
    await waitFor(() => expect(join).toHaveBeenCalledWith("AB3K9Q"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
  });

  it("shows in-room chip with code when participating", async () => {
    mockParty = {
      ...mockParty,
      isHost: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p1", role: "host" },
      },
    };
    const { router } = renderWithRouter(<InRoomChip />);
    const chip = screen.getByRole("link", { name: /in room AB3K9Q/i });
    expect(chip).toHaveAttribute("href", "/rooms/AB3K9Q");
    expect(screen.getByText("Host")).toBeInTheDocument();
    fireEvent.click(chip);
    await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
  });

  it("opens the current room from home without leaving the app", async () => {
    mockParty = {
      ...mockParty,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p1", role: "host" },
      },
    };
    const { router } = renderWithRouter(<GotACodeJoin />);
    fireEvent.click(screen.getByRole("link", { name: /open room/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
  });

  it("creates a room and opens it in the app", async () => {
    const created = vi.fn().mockResolvedValue({ code: "AB3K9Q" });
    mockParty = { ...mockParty, create: created };
    const { router } = renderWithRouter(<RoomsHub />);
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
  });

  it("joins from the hub and opens the room in the app", async () => {
    join.mockResolvedValue({ code: "AB3K9Q" });
    const { router } = renderWithRouter(<RoomsHub />);
    fireEvent.change(screen.getByRole("textbox", { name: /room code/i }), {
      target: { value: "AB3K9Q" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rooms/AB3K9Q"));
  });

  it("shows Become host when takeover is available", () => {
    mockParty = {
      ...mockParty,
      showBecomeHost: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p2", role: "dj" },
      },
    };
    renderWithRouter(<HostFailoverControls />);
    expect(screen.getByRole("button", { name: /become host/i })).toBeInTheDocument();
  });

  it("shows Reclaim host for original host who lost the seat", () => {
    mockParty = {
      ...mockParty,
      showReclaimHost: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p1", role: "dj" },
      },
    };
    renderWithRouter(<HostFailoverControls />);
    expect(screen.getByRole("button", { name: /reclaim host/i })).toBeInTheDocument();
  });

  it("shows Add to room queue only when role can add", async () => {
    mockParty = {
      ...mockParty,
      canAddTracks: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p1", role: "dj" },
      },
    };
    addTrack.mockResolvedValue(undefined);
    renderWithRouter(<AddToRoomQueueAction trackId="track-1" />);
    fireEvent.click(screen.getByRole("button", { name: /add to room queue/i }));
    await waitFor(() => expect(addTrack).toHaveBeenCalledWith("track-1"));
  });

  it("hides Add to room queue for listeners", () => {
    mockParty = {
      ...mockParty,
      canAddTracks: false,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "p1", role: "listener" },
      },
    };
    const { container } = renderWithRouter(<AddToRoomQueueAction trackId="track-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows drag handles for Host/DJ upcoming tracks", () => {
    mockParty = {
      ...mockParty,
      isHost: true,
      canTransport: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        me: { id: "p1", role: "host", userId: "u1" },
        queue: [
          queueItem("q0", 0, "Now"),
          queueItem("q1", 1, "Next A"),
          queueItem("q2", 2, "Next B"),
        ],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: "track-q0" },
      },
    };
    renderWithRouter(<RoomQueuePanel />);
    expect(screen.getByText(/drag to reorder/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag to reorder next a/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag to reorder next b/i)).toBeInTheDocument();
  });

  it("hides drag handles for listeners", () => {
    mockParty = {
      ...mockParty,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        me: { id: "p2", role: "listener", userId: "u2" },
        queue: [queueItem("q0", 0, "Now"), queueItem("q1", 1, "Next A")],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: "track-q0" },
      },
    };
    renderWithRouter(<RoomQueuePanel />);
    expect(screen.queryByText(/drag to reorder/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/drag to reorder/i)).not.toBeInTheDocument();
  });

  it("guest Room tab shows live queue reorder, Become host, and Leave", () => {
    mockParty = {
      ...mockParty,
      showBecomeHost: true,
      refresh: vi.fn(),
      leave: vi.fn(),
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 2,
        me: { id: "g1", role: "dj", userId: null, isGuest: true, displayName: "Walkup" },
        queue: [
          queueItem("q0", 0, "Now"),
          queueItem("q1", 1, "Guest Next"),
          queueItem("q2", 2, "Guest Next B"),
        ],
        playback: { isPlaying: true, currentIndex: 0, currentTrackId: "track-q0" },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="dj" displayName="Walkup" />);
    expect(screen.getByRole("button", { name: /become host/i })).toBeInTheDocument();
    expect(screen.getByText(/drag to reorder/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag to reorder guest next\./i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drag to reorder guest next b/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave room/i })).toBeInTheDocument();
    const identity = screen.getByText(/joined as a guest/i);
    expect(identity).toHaveTextContent("Walkup");
    expect(identity).toHaveTextContent("DJ");
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("says a logged-out guest joined as a guest, with display name and role", () => {
    mockParty = {
      ...mockParty,
      refresh: vi.fn(),
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        me: {
          id: "g1",
          role: "listener",
          userId: null,
          isGuest: true,
          displayName: "QA Guest",
        },
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="listener" displayName="QA Guest" />);
    const identity = screen.getByText(/joined as a guest/i);
    expect(identity).toHaveTextContent("Joined as a guest QA Guest (Listener)");
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("says a logged-out guest joined as a guest before the room snapshot arrives", () => {
    mockParty = {
      ...mockParty,
      room: null,
      loading: false,
      refresh: vi.fn(),
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="listener" displayName="QA Guest" />);
    const identity = screen.getByText(/joined as a guest/i);
    expect(identity).toHaveTextContent("Joined as a guest QA Guest (Listener)");
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("keeps signed-in copy for a linked member", () => {
    mockParty = {
      ...mockParty,
      refresh: vi.fn(),
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        me: {
          id: "p1",
          role: "listener",
          userId: "u1",
          isGuest: false,
          displayName: "Kody",
        },
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="listener" displayName="Kody" />);
    const identity = screen.getByText(/signed in as/i);
    expect(identity).toHaveTextContent("Signed in as Kody (Listener)");
    expect(screen.queryByText(/joined as a guest/i)).not.toBeInTheDocument();
  });

  it("guest Leave room posts using the known join code even before snapshot sync", async () => {
    leave.mockResolvedValue(undefined);
    mockParty = {
      ...mockParty,
      room: null,
      loading: true,
      refresh: vi.fn(),
      leave,
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="listener" displayName="Walkup" />);
    fireEvent.click(screen.getByRole("button", { name: /leave room/i }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith("AB3K9Q"));
    expect(end).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("guest Room tab reflects live host role after takeover", () => {
    mockParty = {
      ...mockParty,
      isHost: true,
      canTransport: true,
      showBecomeHost: false,
      refresh: vi.fn(),
      leave: vi.fn(),
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 3,
        me: { id: "g1", role: "host", userId: null, isGuest: true, displayName: "Walkup" },
        queue: [queueItem("q0", 0, "Now")],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: "track-q0" },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="dj" displayName="Walkup" />);
    const identity = screen.getByText(/signed in as/i);
    expect(identity).toHaveTextContent("Signed in as Walkup (Host)");
    expect(screen.queryByText(/joined as a guest/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /become host/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end room$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leave room/i })).not.toBeInTheDocument();
  });

  it("lets Host promote and kick other participants", async () => {
    setRole.mockResolvedValue(undefined);
    kick.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ playlists: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    mockParty = {
      ...mockParty,
      canManage: true,
      isHost: true,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        defaultJoinRole: "listener",
        me: { id: "p1", role: "host", userId: "u1" },
        participants: [
          {
            id: "p1",
            displayName: "Kody",
            role: "host",
            userId: "u1",
            isGuest: false,
            lastHeartbeatAt: null,
            isOriginalHost: true,
          },
          {
            id: "p2",
            displayName: "Alex",
            role: "listener",
            userId: "u2",
            isGuest: false,
            lastHeartbeatAt: null,
            isOriginalHost: false,
          },
        ],
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
        joinUrl: "/rooms/AB3K9Q",
        qrDataUrl: null,
      },
    };
    renderWithRouter(<RoomsHub />);
    fireEvent.click(screen.getByRole("button", { name: /make dj/i }));
    await waitFor(() => expect(setRole).toHaveBeenCalledWith("p2", "dj"));
    fireEvent.click(screen.getByRole("button", { name: /kick/i }));
    await waitFor(() => expect(kick).toHaveBeenCalledWith("p2"));
    expect(screen.getByText(/add playlist to queue/i)).toBeInTheDocument();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it("asks the Host to confirm before ending the room for everyone", async () => {
    end.mockResolvedValue(undefined);
    renderOpenHub({ role: "host", isOriginalHost: true });
    const dialog = openEndRoomConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: /^end room$/i }));
    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    expect(end).toHaveBeenCalledWith();
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves the room open when the Host dismisses End room", () => {
    renderOpenHub({ role: "host" });
    const dialog = openEndRoomConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(end).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "AB3K9Q" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end room$/i })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("ends the room when a replacement Host confirms, including for the creator", async () => {
    end.mockResolvedValue(undefined);
    const creator = seat({
      id: "p-creator",
      displayName: "Kody",
      role: "dj",
      userId: "u1",
      isOriginalHost: true,
    });
    renderOpenHub({
      role: "host",
      isOriginalHost: false,
      meId: "p-guest",
      displayName: "Alex",
      participants: [
        creator,
        seat({
          id: "p-guest",
          displayName: "Alex",
          role: "host",
          userId: null,
          isGuest: true,
          isOriginalHost: false,
        }),
      ],
    });
    const dialog = openEndRoomConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: /^end room$/i }));
    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    expect(leave).not.toHaveBeenCalled();
  });

  it("DJ Leave only removes that seat and does not end the room", async () => {
    leave.mockResolvedValue(undefined);
    renderOpenHub({ role: "dj", isOriginalHost: true });
    expect(screen.queryByRole("button", { name: /^end room$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^leave$/i }));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(leave).toHaveBeenCalledWith();
    expect(end).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Listener Leave only removes that seat and does not end the room", async () => {
    leave.mockResolvedValue(undefined);
    renderOpenHub({ role: "listener" });
    fireEvent.click(screen.getByRole("button", { name: /^leave$/i }));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(end).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("guest Host confirms End room instead of a quiet Leave", async () => {
    end.mockResolvedValue(undefined);
    mockParty = {
      ...mockParty,
      isHost: true,
      canManage: true,
      canTransport: true,
      refresh: vi.fn(),
      end,
      leave,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 4,
        me: {
          id: "g1",
          role: "host",
          userId: null,
          isGuest: true,
          displayName: "Alex",
          isOriginalHost: false,
        },
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="dj" displayName="Alex" />);
    expect(screen.queryByRole("button", { name: /leave room/i })).not.toBeInTheDocument();
    const dialog = openEndRoomConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: /^end room$/i }));
    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    expect(end).toHaveBeenCalledWith();
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves the guest room open when the Host dismisses End room", () => {
    mockParty = {
      ...mockParty,
      isHost: true,
      canManage: true,
      refresh: vi.fn(),
      end,
      leave,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "g1", role: "host", userId: null, isGuest: true, displayName: "Alex" },
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="host" displayName="Alex" />);
    const dialog = openEndRoomConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(end).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByText("AB3K9Q")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end room$/i })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("guest DJ Leave room only removes that seat", async () => {
    leave.mockResolvedValue(undefined);
    mockParty = {
      ...mockParty,
      refresh: vi.fn(),
      end,
      leave,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        me: { id: "g1", role: "dj", userId: null, isGuest: true, displayName: "Walkup" },
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      },
    };
    renderWithRouter(<GuestRoomLivePanel code="AB3K9Q" role="dj" displayName="Walkup" />);
    expect(screen.queryByRole("button", { name: /^end room$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^leave room$/i }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith("AB3K9Q"));
    expect(end).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps Away participants, marks them Away, and drops the original host label", () => {
    const now = Date.now();
    mockParty = {
      ...mockParty,
      canManage: false,
      isHost: false,
      room: {
        id: "r1",
        code: "AB3K9Q",
        status: "open",
        roomVersion: 1,
        defaultJoinRole: "listener",
        currentHostParticipantId: "p1",
        me: { id: "p3", role: "listener", userId: "u3", displayName: "Sam" },
        participants: [
          {
            id: "p1",
            displayName: "Kody",
            role: "host",
            userId: "u1",
            isGuest: false,
            // Speaker within the 30s silence window — still here.
            lastHeartbeatAt: new Date(now - 15_000).toISOString(),
            isOriginalHost: true,
          },
          {
            id: "p2",
            displayName: "Alex",
            role: "dj",
            userId: "u2",
            isGuest: false,
            // Non-speaker past the 10s Away threshold.
            lastHeartbeatAt: new Date(now - 15_000).toISOString(),
            isOriginalHost: false,
          },
          {
            id: "p3",
            displayName: "Sam",
            role: "listener",
            userId: "u3",
            isGuest: false,
            lastHeartbeatAt: new Date(now - 1_000).toISOString(),
            isOriginalHost: false,
          },
        ],
        queue: [],
        playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
        joinUrl: "/rooms/AB3K9Q",
        qrDataUrl: null,
      },
    };
    renderWithRouter(<RoomsHub />);

    const items = screen.getAllByRole("listitem");
    const text = (name: string) => items.find((item) => item.textContent?.includes(name));
    expect(text("Kody")).toBeTruthy();
    expect(text("Alex")).toBeTruthy();
    expect(text("Sam")).toBeTruthy();
    expect(text("Alex")?.textContent).toMatch(/Away/);
    expect(text("Kody")?.textContent).not.toMatch(/Away/);
    expect(text("Sam")?.textContent).not.toMatch(/Away/);
    expect(screen.queryByText(/original host/i)).not.toBeInTheDocument();
  });

  it("counts one queued track as singular", () => {
    renderQueuePanel({
      queue: [queueItem("q0", 0, "Only")],
      currentTrackId: "track-q0",
    });
    expect(screen.getByText("1 track")).toBeInTheDocument();
    expect(screen.queryByText("1 tracks")).not.toBeInTheDocument();
  });

  it("counts more than one queued track as plural", () => {
    renderQueuePanel({
      queue: [queueItem("q0", 0, "First"), queueItem("q1", 1, "Second")],
      currentTrackId: "track-q0",
    });
    expect(screen.getByText("2 tracks")).toBeInTheDocument();
  });

  it("hides Play and Skip while the queue is empty", () => {
    renderQueuePanel({ queue: [], canTransport: true, isHost: true });
    expect(screen.getByText("0 tracks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^play$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^skip$/i })).not.toBeInTheDocument();
  });

  it("shows Play and Skip once the queue has a track", () => {
    renderQueuePanel({
      queue: [queueItem("q0", 0, "Only")],
      canTransport: true,
      isHost: true,
      currentTrackId: "track-q0",
    });
    expect(screen.getByRole("button", { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^skip$/i })).toBeInTheDocument();
  });

  it("tells a listener that a host or DJ adds tracks when the queue is empty", () => {
    renderQueuePanel({
      role: "listener",
      isHost: false,
      canTransport: false,
      canManage: false,
      queue: [],
    });
    const empty = screen.getByText(/queue is empty/i);
    expect(empty).toHaveTextContent(/a host or dj adds tracks/i);
    expect(empty).not.toHaveTextContent(/library/i);
    expect(empty).not.toHaveTextContent(/playlist/i);
  });

  it("tells a DJ who cannot add a playlist that a host or DJ adds tracks", () => {
    renderQueuePanel({
      role: "dj",
      isHost: false,
      canTransport: false,
      canManage: false,
      queue: [],
    });
    const empty = screen.getByText(/queue is empty/i);
    expect(empty).toHaveTextContent(/a host or dj adds tracks/i);
    expect(empty).not.toHaveTextContent(/library/i);
    expect(empty).not.toHaveTextContent(/playlist/i);
  });

  it("lets the host empty queue mention the library or a playlist", () => {
    renderQueuePanel({ role: "host", canManage: true, queue: [] });
    const empty = screen.getByText(/queue is empty/i);
    expect(empty.textContent).toMatch(/library|playlist/i);
    expect(empty).not.toHaveTextContent(/a host or dj adds tracks/i);
  });

  it("labels the current row Ready until playback is actually playing", () => {
    renderQueuePanel({
      queue: [queueItem("q0", 0, "Warmup"), queueItem("q1", 1, "Later")],
      isPlaying: false,
      currentIndex: 0,
      currentTrackId: "track-q0",
    });
    expect(screen.queryByRole("heading", { name: /^now playing$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^ready$/i })).toBeInTheDocument();
    const current = screen.getByRole("listitem", { current: true });
    expect(current).toHaveTextContent("Warmup");
    expect(current).not.toHaveTextContent("Later");
    expect(current).not.toHaveTextContent(/now playing/i);
    expect(current.className).toMatch(/bg-primary/);
  });

  it("labels the current row Now playing only while playback is playing", () => {
    renderQueuePanel({
      queue: [queueItem("q0", 0, "Warmup"), queueItem("q1", 1, "Later")],
      isPlaying: true,
      currentIndex: 0,
      currentTrackId: "track-q0",
    });
    expect(screen.getByRole("heading", { name: /^now playing$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^ready$/i })).not.toBeInTheDocument();
    const current = screen.getByRole("listitem", { current: true });
    expect(current).toHaveTextContent("Warmup");
    expect(current).not.toHaveTextContent(/paused/i);
  });

  it("keeps a paused current row identifiable", () => {
    renderQueuePanel({
      role: "listener",
      isHost: false,
      canTransport: false,
      canManage: false,
      queue: [
        queueItem("q0", 0, "Done"),
        queueItem("q1", 1, "Warmup"),
        queueItem("q2", 2, "Later"),
      ],
      isPlaying: false,
      currentIndex: 1,
      currentTrackId: "track-q1",
    });
    expect(screen.queryByRole("heading", { name: /^now playing$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^played$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^ready$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^up next$/i })).toBeInTheDocument();
    const current = screen.getByRole("listitem", { current: true });
    expect(current).toHaveTextContent("Warmup");
    expect(current).toHaveTextContent(/paused/i);
    expect(current).not.toHaveTextContent("Done");
    expect(current).not.toHaveTextContent("Later");
    expect(current.className).toMatch(/bg-primary/);
  });
});

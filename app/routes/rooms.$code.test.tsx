/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import GuestJoinOrRoom from "./rooms.$code._index.tsx";
import RoomByCodeRoute, { loader as roomLoader } from "./rooms.$code.tsx";

const leave = vi.fn();
const end = vi.fn();
const refresh = vi.fn();

type MockRoom = {
  id: string;
  code: string;
  status: string;
  roomVersion: number;
  me: {
    id: string;
    role: string;
    displayName: string;
    userId: null;
    isGuest: boolean;
  } | null;
  participants: Array<{ id: string; displayName: string; role: string }>;
  queue: Array<{
    id: string;
    position: number;
    trackId: string;
    track: {
      id: string;
      title: string;
      artistName: string;
      duration: number;
      coverObjectKey: null;
      hasAudio: boolean;
    };
    addedByParticipantId: string;
    addedByDisplayName: string;
    createdAt: string;
  }>;
  playback: { isPlaying: boolean; currentIndex: number; currentTrackId: string | null };
};

let mockParty: {
  room: MockRoom | null;
  loading: boolean;
  error: string | null;
  apiUnavailable: boolean;
  isHost: boolean;
  canAddTracks: boolean;
  canTransport: boolean;
  canManage: boolean;
  showBecomeHost: boolean;
  showReclaimHost: boolean;
  refresh: typeof refresh;
  leave: typeof leave;
  end: typeof end;
  join: ReturnType<typeof vi.fn>;
  becomeHostNow: ReturnType<typeof vi.fn>;
  reclaimHostNow: ReturnType<typeof vi.fn>;
};

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
  usePartyRoom: () => mockParty,
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

function queueItem(title: string) {
  return {
    id: "q1",
    position: 0,
    trackId: "track-1",
    track: {
      id: "track-1",
      title,
      artistName: "Artist",
      duration: 180,
      coverObjectKey: null,
      hasAudio: true,
    },
    addedByParticipantId: "h1",
    addedByDisplayName: "Host",
    createdAt: new Date().toISOString(),
  };
}

function openRoom(role: "dj" | "listener" | "host", title = "Now"): MockRoom {
  return {
    id: "r1",
    code: "AB3K9Q",
    status: "open",
    roomVersion: 1,
    me: { id: "g1", role, displayName: "Walkup", userId: null, isGuest: true },
    participants: [
      { id: "h1", displayName: "Host", role: "host" },
      { id: "g1", displayName: "Walkup", role },
    ],
    queue: [queueItem(title)],
    playback: { isPlaying: true, currentIndex: 0, currentTrackId: "track-1" },
  };
}

const seatedLoader = {
  mode: "guest" as const,
  guestShell: true as const,
  code: "AB3K9Q",
  room: {
    id: "r1",
    code: "AB3K9Q",
    status: "open",
    defaultJoinRole: "listener",
    currentIndex: 0,
    roomVersion: 1,
    isPlaying: true,
  },
  ended: false,
  invalidCode: false,
  participant: {
    id: "g1",
    roomId: "r1",
    roomCode: "AB3K9Q",
    displayName: "Walkup",
    role: "listener" as const,
    roomStatus: "open" as const,
    defaultJoinRole: "listener" as const,
    userId: null,
  },
  canAddTracks: false,
  queue: [],
};

function renderShell(entry: string, parentLoader: unknown, indexLoader?: unknown) {
  function RouteHarness() {
    const [, bump] = useState(0);
    return (
      <>
        <button type="button" onClick={() => bump((n) => n + 1)}>
          Sync room
        </button>
        <RoomByCodeRoute />
      </>
    );
  }

  const router = createMemoryRouter(
    [
      { path: "/", HydrateFallback: () => null, element: <p>Home</p> },
      {
        path: "/rooms/:code",
        HydrateFallback: () => null,
        loader: () => parentLoader,
        Component: RouteHarness,
        children: [
          {
            index: true,
            HydrateFallback: () => null,
            loader: () =>
              indexLoader ?? {
                code: "AB3K9Q",
                seated: Boolean(
                  parentLoader &&
                  typeof parentLoader === "object" &&
                  "participant" in parentLoader &&
                  parentLoader.participant,
                ),
                participant:
                  parentLoader && typeof parentLoader === "object" && "participant" in parentLoader
                    ? parentLoader.participant
                    : null,
              },
            Component: GuestJoinOrRoom,
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );

  return render(<RouterProvider router={router} />);
}

describe("guest room shell", () => {
  beforeEach(async () => {
    leave.mockReset();
    leave.mockResolvedValue(undefined);
    end.mockReset();
    refresh.mockReset();
    mockParty = {
      room: null,
      loading: false,
      error: null,
      apiUnavailable: false,
      isHost: false,
      canAddTracks: false,
      canTransport: false,
      canManage: false,
      showBecomeHost: false,
      showReclaimHost: false,
      refresh,
      leave,
      end,
      join: vi.fn(),
      becomeHostNow: vi.fn(),
      reclaimHostNow: vi.fn(),
    };
    await prisma.roomPlayEvent.deleteMany();
    await prisma.roomQueueItem.deleteMany();
    await prisma.roomParticipant.deleteMany();
    await prisma.room.deleteMany();
  });

  test("ended room copy is used only when the room row has ended", async () => {
    const host = await prisma.user.create({
      data: { ...createUser(), roles: { connect: { name: "user" } } },
    });
    await prisma.room.create({
      data: {
        code: "AB3K9Q",
        status: "ended",
        endedAt: new Date(),
        originalHostUserId: host.id,
      },
    });

    const ended = await roomLoader({
      request: new Request("http://localhost/rooms/AB3K9Q"),
      params: { code: "AB3K9Q" },
    } as never);
    renderShell("/rooms/AB3K9Q", ended.data);
    expect(await screen.findByText("This room has ended.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Room not found" })).not.toBeInTheDocument();
    cleanup();

    const missing = await roomLoader({
      request: new Request("http://localhost/rooms/ZZZZ99"),
      params: { code: "ZZZZ99" },
    } as never);
    renderShell("/rooms/ZZZZ99", missing.data);
    expect(await screen.findByText("Room not found")).toBeInTheDocument();
    expect(screen.queryByText("This room has ended.")).not.toBeInTheDocument();
  });

  test("codes that use 0, O, or I explain the alphabet", async () => {
    for (const code of ["AB3K0Q", "OOOOOO", "IIIIII"]) {
      const result = await roomLoader({
        request: new Request(`http://localhost/rooms/${code}`),
        params: { code },
      } as never);
      renderShell(`/rooms/${code}`, result.data);
      expect(await screen.findByText(/A–Z and 1–9, without 0, O, or I/i)).toBeInTheDocument();
      expect(screen.queryByText("Room not found")).not.toBeInTheDocument();
      cleanup();
    }
  });

  test("the live role reads DJ", async () => {
    mockParty = { ...mockParty, room: openRoom("dj"), canAddTracks: true };
    renderShell("/rooms/AB3K9Q", {
      ...seatedLoader,
      participant: { ...seatedLoader.participant, role: "dj" },
      canAddTracks: true,
    });
    expect((await screen.findAllByText("DJ")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Dj")).not.toBeInTheDocument();
    expect(screen.queryByText("dj")).not.toBeInTheDocument();
  });

  test("the open guest tab shows the live queue and updates without reload", async () => {
    mockParty = { ...mockParty, room: openRoom("listener", "First Song") };
    renderShell("/rooms/AB3K9Q", seatedLoader);
    expect(await screen.findByText(/First Song/)).toBeInTheDocument();

    mockParty = { ...mockParty, room: openRoom("listener", "Second Song") };
    fireEvent.click(screen.getByRole("button", { name: "Sync room" }));
    expect(await screen.findByText(/Second Song/)).toBeInTheDocument();
    expect(screen.queryByText(/First Song/)).not.toBeInTheDocument();
  });

  test("kick replaces the room tab with the join form", async () => {
    mockParty = { ...mockParty, room: openRoom("listener") };
    renderShell("/rooms/AB3K9Q", seatedLoader);
    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();

    mockParty = {
      ...mockParty,
      room: {
        ...openRoom("listener"),
        me: null,
        participants: [{ id: "h1", displayName: "Host", role: "host" }],
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "Sync room" }));

    expect(await screen.findByText("The host removed you from this room.")).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  test("end room replaces the open guest tab with the ended sentence", async () => {
    mockParty = { ...mockParty, room: openRoom("listener") };
    renderShell("/rooms/AB3K9Q", seatedLoader);
    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();

    mockParty = { ...mockParty, room: null, loading: false };
    fireEvent.click(screen.getByRole("button", { name: "Sync room" }));

    expect(await screen.findByText("This room has ended.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leave room/i })).not.toBeInTheDocument();
  });

  test("Leave room leaves instead of treating the tab as ended", async () => {
    leave.mockImplementation(async () => {
      mockParty = { ...mockParty, room: null, loading: false };
    });
    mockParty = { ...mockParty, room: openRoom("listener"), leave };
    renderShell("/rooms/AB3K9Q", seatedLoader);
    fireEvent.click(await screen.findByRole("button", { name: /leave room/i }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith("AB3K9Q"));
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("This room has ended.")).not.toBeInTheDocument();
  });
});

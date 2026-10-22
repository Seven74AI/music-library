/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomsHub } from "#app/components/party-room/rooms-hub.tsx";
import { toast } from "#app/components/ui/use-toast.ts";

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

const baseParty = {
  room: null as null | Record<string, unknown>,
  loading: false,
  error: null as string | null,
  apiUnavailable: false,
  qrLoadError: null as string | null,
  isHost: false,
  canAddTracks: false,
  canTransport: false,
  canManage: false,
  showBecomeHost: false,
  showReclaimHost: false,
  refresh: vi.fn(),
  create: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  end: vi.fn(),
  becomeHostNow: vi.fn(),
  reclaimHostNow: vi.fn(),
  setDefaultJoinRole: vi.fn(),
  addTrack: vi.fn(),
  addPlaylist: vi.fn(),
  reorderUpcoming: vi.fn(),
  setRole: vi.fn(),
  kick: vi.fn(),
  transport: vi.fn(),
  clearError: vi.fn(),
};

let mockParty = { ...baseParty };

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
  usePartyRoom: () => mockParty,
}));

function renderHub() {
  const router = createMemoryRouter([{ path: "/", element: <RoomsHub /> }], {
    initialEntries: ["/"],
  });
  return render(<RouterProvider router={router} />);
}

function openRoom(overrides: Record<string, unknown> = {}) {
  const me = {
    id: "p1",
    displayName: "Kody",
    role: "host",
    userId: "u1",
    isGuest: false,
    lastHeartbeatAt: null,
    isOriginalHost: true,
  };
  mockParty = {
    ...baseParty,
    room: {
      id: "r1",
      code: "AB3K9Q",
      status: "open",
      roomVersion: 1,
      defaultJoinRole: "listener",
      currentHostParticipantId: "p1",
      me,
      participants: [
        me,
        {
          id: "p2",
          displayName: "Alex",
          role: "dj",
          userId: "u2",
          isGuest: false,
          lastHeartbeatAt: new Date().toISOString(),
          isOriginalHost: false,
        },
      ],
      queue: [],
      playback: { isPlaying: false, currentIndex: 0, currentTrackId: null },
      joinUrl: "https://example.com/rooms/AB3K9Q",
      qrDataUrl: "data:image/png;base64,qr",
      ...overrides,
    },
  };
}

describe("RoomsHub join copy", () => {
  beforeEach(() => {
    mockParty = { ...baseParty, room: null };
    vi.mocked(toast).mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("toasts Link copied when copying the join link", async () => {
    openRoom();
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({ title: "Link copied" });
    });
  });

  it("toasts Code copied when copying the room code", async () => {
    openRoom();
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({ title: "Code copied" });
    });
  });

  it("labels the DJ role as DJ", () => {
    openRoom();
    renderHub();
    const alex = screen.getByText("Alex").closest("li");
    expect(alex).toHaveTextContent("DJ");
    expect(alex).not.toHaveTextContent("Dj");
  });

  it("shows already_in_room on the open room without hiding the code", () => {
    openRoom();
    mockParty = {
      ...mockParty,
      error: "Leave your current room before joining another",
    };
    renderHub();
    expect(screen.getByRole("heading", { name: "AB3K9Q" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Leave your current room before joining another",
    );
  });

  it("says when the join QR image cannot be loaded", () => {
    openRoom({ qrDataUrl: null });
    mockParty = {
      ...mockParty,
      qrLoadError: "The join QR code could not be loaded.",
    };
    renderHub();
    expect(screen.getByRole("status")).toHaveTextContent("The join QR code could not be loaded.");
  });

  it("says when the QR image element fails to load", () => {
    openRoom();
    renderHub();
    fireEvent.error(screen.getByRole("img", { name: /qr code to join room AB3K9Q/i }));
    expect(screen.getByRole("status")).toHaveTextContent("The join QR code could not be loaded.");
  });
});

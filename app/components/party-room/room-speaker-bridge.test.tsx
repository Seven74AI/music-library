/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSpeakerBridge } from "#app/components/party-room/room-speaker-bridge.tsx";
import { type RoomAutoplayOutcome } from "#app/components/audio-player-room-playback.ts";
import { reportRoomPlayEvent } from "#app/features/party-room/api.client.ts";

const transport = vi.fn();
const setRoomPlaybackPlaying = vi.fn();
const syncRoomSpeakerQueue = vi.fn();

let autoplayListener: ((outcome: RoomAutoplayOutcome) => void) | null = null;

const mockAudio = {
  suspendPersonalPersistence: vi.fn(),
  resumePersonalPersistence: vi.fn(),
  getPersonalPlayerSnapshot: vi.fn(() => ({
    playContext: null,
    currentTrackId: null,
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off" as const,
  })),
  isPlayerVisible: false,
  restorePersonalPlayerSnapshot: vi.fn(),
  syncRoomSpeakerQueue,
  setRoomPlaybackPlaying,
  subscribeRoomAutoplay: (listener: (outcome: RoomAutoplayOutcome) => void) => {
    autoplayListener = listener;
    return () => {
      autoplayListener = null;
    };
  },
};

let mockParty: { room: Record<string, unknown> | null; transport: typeof transport } = {
  room: null,
  transport,
};

vi.mock("#app/components/audio-player-provider", () => ({
  useAudioPlayer: () => mockAudio,
}));

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
}));

vi.mock("#app/features/party-room/api.client.ts", () => ({
  reportRoomPlayEvent: vi.fn(),
}));

function queueItem(title: string) {
  return {
    id: "q0",
    position: 0,
    trackId: "track-q0",
    track: {
      id: "track-q0",
      title,
      artistName: "Artist",
      duration: 180,
      coverObjectKey: null,
      hasAudio: true,
    },
    addedByParticipantId: "host-1",
    addedByDisplayName: "Kody",
    createdAt: new Date().toISOString(),
  };
}

function roomFixture({ meId, isPlaying }: { meId: string; isPlaying: boolean }) {
  return {
    id: "room-1",
    code: "AB3K9Q",
    status: "open",
    currentHostParticipantId: "host-1",
    me: { id: meId, role: meId === "host-1" ? "host" : "listener", displayName: "Listener" },
    participants: [
      {
        id: "host-1",
        displayName: "Kody",
        role: "host",
        userId: "user-host",
        isGuest: false,
        lastHeartbeatAt: null,
        isOriginalHost: true,
      },
      {
        id: "listener-1",
        displayName: "Listener",
        role: "listener",
        userId: "user-listener",
        isGuest: false,
        lastHeartbeatAt: null,
        isOriginalHost: false,
      },
    ],
    queue: [queueItem("Night Drive")],
    playback: { isPlaying, currentIndex: 0, currentTrackId: "track-q0" },
  };
}

function renderBridge() {
  const router = createMemoryRouter([{ path: "/", element: <RoomSpeakerBridge /> }], {
    initialEntries: ["/"],
  });
  return render(<RouterProvider router={router} />);
}

describe("RoomSpeakerBridge", () => {
  beforeEach(() => {
    transport.mockReset();
    transport.mockResolvedValue(undefined);
    setRoomPlaybackPlaying.mockReset();
    syncRoomSpeakerQueue.mockReset();
    autoplayListener = null;
    vi.mocked(reportRoomPlayEvent).mockClear();
  });

  it("names the host on the read-only now-playing bar", () => {
    mockParty = { room: roomFixture({ meId: "listener-1", isPlaying: true }), transport };
    renderBridge();
    expect(screen.getByTestId("room-now-playing-bar").className).toContain("z-50");
    expect(screen.getByText("Kody is the speaker")).toBeInTheDocument();
    expect(screen.getByText("Night Drive")).toBeInTheDocument();
  });

  it("blocked autoplay leaves the room paused and does not report room playback as playing", async () => {
    mockParty = { room: roomFixture({ meId: "host-1", isPlaying: true }), transport };
    renderBridge();

    await waitFor(() => expect(autoplayListener).toEqual(expect.any(Function)));
    autoplayListener!("blocked");

    await waitFor(() => expect(transport).toHaveBeenCalledWith({ action: "pause" }));
    expect(reportRoomPlayEvent).not.toHaveBeenCalled();
    expect(setRoomPlaybackPlaying).toHaveBeenCalledWith(false);
  });

  it("does not pause the room when audio actually starts", async () => {
    mockParty = { room: roomFixture({ meId: "host-1", isPlaying: true }), transport };
    renderBridge();

    await waitFor(() => expect(autoplayListener).toEqual(expect.any(Function)));
    autoplayListener!("started");

    expect(transport).not.toHaveBeenCalled();
    expect(reportRoomPlayEvent).not.toHaveBeenCalled();
  });
});

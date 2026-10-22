/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeActiveRoomCode } from "./api.client.ts";
import { PartyRoomProvider, usePartyRoom } from "./party-room-provider.tsx";

vi.mock("#app/utils/user.ts", () => ({
  useOptionalUser: () => null,
}));

function LeaveOnMount() {
  const { leave } = usePartyRoom();
  useEffect(() => {
    void leave();
  }, [leave]);
  return null;
}

describe("PartyRoomProvider leave before snapshot", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("POSTs leave using the sessionStorage code while GET snapshot is still in flight", async () => {
    writeActiveRoomCode("AB3K9Q");
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/leave")) {
        return new Response(JSON.stringify({ left: true, remaining: 0 }), { status: 200 });
      }
      // Keep the snapshot GET pending so roomCodeRef stays null (guest join race).
      await new Promise(() => {});
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <LeaveOnMount />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(calls).toContain("POST /api/rooms/AB3K9Q/leave");
    });
  });

  it("heartbeats for a non-host while the room page is open", async () => {
    writeActiveRoomCode("AB3K9Q");
    const calls: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public url: string) {}
        close() {}
      },
    );
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/heartbeat")) {
        return new Response(
          JSON.stringify({
            ok: true,
            lastSeenAt: new Date().toISOString(),
            hostTakeoverAvailable: false,
            emptySince: null,
            participants: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          roomId: "room-1",
          code: "AB3K9Q",
          status: "open",
          defaultJoinRole: "listener",
          roomVersion: 1,
          currentIndex: 0,
          isPlaying: false,
          currentHostParticipantId: "host-1",
          me: {
            id: "listener-1",
            displayName: "Alex",
            role: "listener",
            userId: null,
            lastSeenAt: new Date().toISOString(),
            isOriginalHost: false,
          },
          participants: [
            {
              id: "host-1",
              userId: "user-1",
              displayName: "Kody",
              role: "host",
              lastSeenAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
            {
              id: "listener-1",
              userId: null,
              displayName: "Alex",
              role: "listener",
              lastSeenAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
          queue: [],
          createdAt: new Date().toISOString(),
          endedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <div />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(calls).toContain("POST /api/rooms/AB3K9Q/heartbeat");
    });
  });

  it("does not heartbeat when GET /api/rooms/current has no seat", async () => {
    writeActiveRoomCode("AB3K9Q");
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <div />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(calls).toContain("GET /api/rooms/current");
    });
    expect(calls.some((call) => call.includes("/heartbeat"))).toBe(false);
    expect(sessionStorage.getItem("party-room.active-code")).toBeNull();
  });
});

const QR = "data:image/png;base64,join-qr";

function roomPayload(overrides: Record<string, unknown> = {}) {
  return {
    roomId: "room-1",
    code: "AB3K9Q",
    status: "open",
    defaultJoinRole: "listener",
    roomVersion: 1,
    currentIndex: 0,
    isPlaying: false,
    currentHostParticipantId: "host-1",
    me: {
      id: "host-1",
      displayName: "Kody",
      role: "host",
      userId: null,
      lastSeenAt: new Date().toISOString(),
      isOriginalHost: true,
    },
    participants: [
      {
        id: "host-1",
        userId: "user-1",
        displayName: "Kody",
        role: "host",
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
    queue: [],
    createdAt: new Date().toISOString(),
    endedAt: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function heartbeatResponse() {
  return jsonResponse({
    ok: true,
    lastSeenAt: new Date().toISOString(),
    hostTakeoverAvailable: false,
    emptySince: null,
    participants: [],
  });
}

class MockEventSource {
  static latest: MockEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    MockEventSource.latest = this;
  }
  close() {}
}

function qrLoadErrorOf(party: object): string {
  if (!("qrLoadError" in party)) return "";
  const value = (party as { qrLoadError?: string | null }).qrLoadError;
  return value ?? "";
}

function RoomProbe() {
  const party = usePartyRoom();
  return (
    <div>
      <button type="button" onClick={() => void party.join("ZZZZZZ").catch(() => {})}>
        Join missing
      </button>
      <button type="button" onClick={() => void party.join("CD4M2P").catch(() => {})}>
        Join other
      </button>
      <button type="button" onClick={() => void party.create().catch(() => {})}>
        Create
      </button>
      <span data-testid="qr">{party.room?.qrDataUrl ?? ""}</span>
      <span data-testid="version">{String(party.room?.roomVersion ?? "")}</span>
      <span data-testid="error">{party.error ?? ""}</span>
      <span data-testid="api">{party.apiUnavailable ? "yes" : "no"}</span>
      <span data-testid="code">{party.room?.code ?? ""}</span>
      <span data-testid="qr-error">{qrLoadErrorOf(party)}</span>
    </div>
  );
}

describe("PartyRoomProvider join errors and QR", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    sessionStorage.clear();
    MockEventSource.latest = null;
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("keeps qrDataUrl when a later snapshot omits it", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/current")) {
        return jsonResponse(roomPayload({ qrDataUrl: QR, roomVersion: 1 }));
      }
      return jsonResponse({}, init?.method === "POST" ? 200 : 204);
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("qr").textContent).toBe(QR);
    });

    MockEventSource.latest?.onmessage?.({
      data: JSON.stringify({
        type: "room_snapshot",
        room: roomPayload({ roomVersion: 2 }),
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("version").textContent).toBe("2");
    });
    expect(screen.getByTestId("qr").textContent).toBe(QR);
  });

  it("loads a QR after create when the snapshot omits qrDataUrl", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/qr")) return jsonResponse({ qrDataUrl: QR });
      if (url.includes("/current")) return new Response(null, { status: 204 });
      if (method === "POST" && url.endsWith("/api/rooms")) {
        return jsonResponse({ roomId: "room-1", code: "AB3K9Q", status: "open" });
      }
      if (url.includes("/api/rooms/AB3K9Q")) return jsonResponse(roomPayload());
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/rooms/current",
        expect.objectContaining({ method: "GET" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByTestId("qr").textContent).toBe(QR);
    });
    expect(screen.getByTestId("qr-error").textContent).toBe("");
  });

  it("loads a QR after create when EventSource is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "EventSource");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/qr")) return jsonResponse({ qrDataUrl: QR });
      if (url.includes("/current")) return new Response(null, { status: 204 });
      if (method === "POST" && url.endsWith("/api/rooms")) {
        return jsonResponse({ roomId: "room-1", code: "AB3K9Q", status: "open" });
      }
      if (url.includes("/api/rooms/AB3K9Q")) return jsonResponse(roomPayload());
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/rooms/current",
        expect.objectContaining({ method: "GET" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByTestId("qr").textContent).toBe(QR);
    });
    expect(screen.getByTestId("qr-error").textContent).toBe("");
  });

  it("says when the join QR cannot be loaded", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/qr")) {
        return jsonResponse({ error: "Not Found" }, 404);
      }
      if (url.includes("/current")) return jsonResponse(roomPayload());
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("qr-error").textContent).toBe(
        "The join QR code could not be loaded.",
      );
    });
    expect(screen.getByTestId("api").textContent).toBe("no");
  });

  it("does not mark the API unavailable for a 404 not_found", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/current")) return new Response(null, { status: 204 });
      if (method === "POST" && url.includes("/join")) {
        return jsonResponse({ error: "Room not found", code: "not_found" }, 404);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/rooms/current",
        expect.objectContaining({ method: "GET" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Join missing" }));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("No room with that code.");
    });
    expect(screen.getByTestId("api").textContent).toBe("no");
  });

  it("shows room_ended copy for a 404 without marking the API unavailable", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/current")) return new Response(null, { status: 204 });
      if (method === "POST" && url.includes("/join")) {
        return jsonResponse({ error: "Room has ended", code: "room_ended" }, 404);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/rooms/current",
        expect.objectContaining({ method: "GET" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Join missing" }));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("This room has ended.");
    });
    expect(screen.getByTestId("api").textContent).toBe("no");
  });

  it("keeps the open room and surfaces already_in_room", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/qr")) return jsonResponse({ qrDataUrl: QR });
      if (url.includes("/current")) return jsonResponse(roomPayload({ qrDataUrl: QR }));
      if (method === "POST" && url.includes("/join")) {
        return jsonResponse(
          {
            error: "Leave your current room before joining another",
            code: "already_in_room",
          },
          409,
        );
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("code").textContent).toBe("AB3K9Q");
    });
    fireEvent.click(screen.getByRole("button", { name: "Join other" }));

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe(
        "Leave your current room before joining another",
      );
    });
    expect(screen.getByTestId("code").textContent).toBe("AB3K9Q");
    expect(screen.getByTestId("api").textContent).toBe("no");
    expect(screen.getByTestId("qr").textContent).toBe(QR);
  });

  it("keeps a not_found error when the current-room refresh finishes later", async () => {
    let releaseCurrent: () => void = () => {};
    const currentGate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/heartbeat")) return heartbeatResponse();
      if (url.includes("/qr")) return jsonResponse({ qrDataUrl: QR });
      if (url.includes("/current")) {
        await currentGate;
        return jsonResponse(roomPayload({ qrDataUrl: QR }));
      }
      if (method === "POST" && url.includes("/join")) {
        return jsonResponse({ error: "Room not found", code: "not_found" }, 404);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Join missing" }));
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("No room with that code.");
    });
    releaseCurrent();
    await waitFor(() => {
      expect(screen.getByTestId("code").textContent).toBe("AB3K9Q");
    });
    expect(screen.getByTestId("error").textContent).toBe("No room with that code.");
    expect(screen.getByTestId("api").textContent).toBe("no");
    expect(screen.getByTestId("qr").textContent).toBe(QR);
  });

  it("still marks the API unavailable for a 404 without a party room code", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/current")) return jsonResponse({ error: "Not Found" }, 404);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("api").textContent).toBe("yes");
    });
    expect(screen.getByTestId("code").textContent).toBe("");
  });

  it("still marks the API unavailable for a 501", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/current")) return new Response(null, { status: 204 });
      if (method === "POST" && url.includes("/join")) {
        return jsonResponse({ error: "Not Implemented" }, 501);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    render(
      <PartyRoomProvider>
        <RoomProbe />
      </PartyRoomProvider>,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/rooms/current",
        expect.objectContaining({ method: "GET" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Join missing" }));

    await waitFor(() => {
      expect(screen.getByTestId("api").textContent).toBe("yes");
    });
  });
});

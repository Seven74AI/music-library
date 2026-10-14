/**
 * @vitest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
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
});

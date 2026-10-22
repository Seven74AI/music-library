/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  addPlaylistToRoomQueue,
  addTrackToRoomQueue,
  createRoom,
  fetchCurrentRoom,
  normalizeRoomSnapshot,
  reorderRoomQueue,
  RoomApiError,
  reportRoomPlayEvent,
  writeActiveRoomCode,
  ACTIVE_ROOM_CODE_KEY,
  resolveRoomActionCode,
} from "./api.client.ts";

describe("party-room api.client (backend #294 contract)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches the signed-in seat from GET /api/rooms/current when the cache is empty", async () => {
    expect(sessionStorage.getItem(ACTIVE_ROOM_CODE_KEY)).toBeNull();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          roomId: "room-1",
          code: "AB3K9Q",
          status: "open",
          defaultJoinRole: "listener",
          roomVersion: 1,
          currentIndex: 0,
          isPlaying: false,
          currentHostParticipantId: "host-1",
          originalHostUserId: "user-1",
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
          queue: [
            {
              id: "q1",
              trackId: "t1",
              position: 0,
              addedByParticipantId: "host-1",
              createdAt: new Date().toISOString(),
              track: { id: "t1", title: "One", artist: { name: "A" } },
            },
          ],
          createdAt: new Date().toISOString(),
          endedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const room = await fetchCurrentRoom("user-1");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/current",
      expect.objectContaining({ method: "GET" }),
    );
    expect(room?.code).toBe("AB3K9Q");
    expect(room?.me?.role).toBe("host");
    expect(room?.queue).toHaveLength(1);
    expect(room?.joinUrl).toContain("/rooms/AB3K9Q");
    expect(sessionStorage.getItem(ACTIVE_ROOM_CODE_KEY)).toBe("AB3K9Q");
  });

  it("clears the sessionStorage cache when GET /api/rooms/current has no seat", async () => {
    writeActiveRoomCode("AB3K9Q");
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(fetchCurrentRoom("user-1")).resolves.toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/current",
      expect.objectContaining({ method: "GET" }),
    );
    expect(sessionStorage.getItem(ACTIVE_ROOM_CODE_KEY)).toBeNull();
  });

  it("creates a room via POST /api/rooms and stores code", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ roomId: "room-1", code: "AB3K9Q", status: "open" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            roomId: "room-1",
            code: "AB3K9Q",
            status: "open",
            defaultJoinRole: "dj",
            roomVersion: 1,
            currentIndex: 0,
            isPlaying: false,
            currentHostParticipantId: "host-1",
            participants: [],
            queue: [],
            createdAt: new Date().toISOString(),
            endedAt: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const room = await createRoom({ defaultJoinRole: "dj" });
    expect(sessionStorage.getItem(ACTIVE_ROOM_CODE_KEY)).toBe("AB3K9Q");
    expect(room.code).toBe("AB3K9Q");
  });

  it("adds tracks with intent add_track", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          roomId: "room-1",
          code: "AB3K9Q",
          status: "open",
          defaultJoinRole: "listener",
          roomVersion: 2,
          currentIndex: 0,
          isPlaying: false,
          currentHostParticipantId: "host-1",
          participants: [],
          queue: [],
          createdAt: new Date().toISOString(),
          endedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await addTrackToRoomQueue("AB3K9Q", "track-1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/AB3K9Q/queue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ intent: "add_track", trackId: "track-1" }),
      }),
    );
  });

  it("throws RoomApiError on failure", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );
    await expect(addTrackToRoomQueue("AB3K9Q", "track-1")).rejects.toBeInstanceOf(RoomApiError);
  });

  it("throws RoomApiError when response body is non-JSON HTML", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("<!DOCTYPE html><html><body>Login</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(createRoom({ defaultJoinRole: "dj" })).rejects.toBeInstanceOf(RoomApiError);
  });

  it("unwraps add_playlist { snapshot } responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          addedCount: 2,
          snapshot: {
            roomId: "room-1",
            code: "AB3K9Q",
            status: "open",
            defaultJoinRole: "listener",
            roomVersion: 3,
            currentIndex: 0,
            isPlaying: false,
            currentHostParticipantId: "host-1",
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
            queue: [
              {
                id: "q1",
                trackId: "t1",
                position: 0,
                addedByParticipantId: "host-1",
                createdAt: new Date().toISOString(),
                track: { id: "t1", title: "One", artist: { name: "A" } },
              },
            ],
            createdAt: new Date().toISOString(),
            endedAt: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const room = await addPlaylistToRoomQueue("AB3K9Q", "playlist-1", "user-1");
    expect(room.code).toBe("AB3K9Q");
    expect(room.queue).toHaveLength(1);
    expect(room.me?.role).toBe("host");
  });

  it("copies reclaimParticipantId onto the snapshot", () => {
    const room = normalizeRoomSnapshot(
      {
        roomId: "room-1",
        code: "AB3K9Q",
        status: "open",
        defaultJoinRole: "listener",
        roomVersion: 2,
        currentIndex: 0,
        isPlaying: true,
        currentHostParticipantId: "host-2",
        reclaimParticipantId: "guest-1",
        participants: [
          {
            id: "guest-1",
            userId: null,
            displayName: "Walkup",
            role: "dj",
            lastSeenAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        queue: [],
        createdAt: new Date().toISOString(),
        endedAt: null,
      },
      null,
    );
    expect(room.reclaimParticipantId).toBe("guest-1");
    expect(room.playback.isPlaying).toBe(true);
  });

  it("marks hostTakeoverAvailable when host seat is empty", () => {
    const room = normalizeRoomSnapshot(
      {
        roomId: "room-1",
        code: "AB3K9Q",
        status: "open",
        defaultJoinRole: "listener",
        roomVersion: 1,
        currentIndex: 0,
        isPlaying: false,
        currentHostParticipantId: null,
        participants: [
          {
            id: "dj-1",
            userId: "user-2",
            displayName: "DJ",
            role: "dj",
            lastSeenAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        queue: [],
        createdAt: new Date().toISOString(),
        endedAt: null,
      },
      "user-2",
    );
    expect(room.hostTakeoverAvailable).toBe(true);
  });

  it("reorders upcoming via POST /api/rooms/:code/queue intent reorder", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          roomId: "room-1",
          code: "AB3K9Q",
          status: "open",
          defaultJoinRole: "listener",
          roomVersion: 4,
          currentIndex: 0,
          isPlaying: false,
          currentHostParticipantId: "host-1",
          participants: [],
          queue: [],
          createdAt: new Date().toISOString(),
          endedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await reorderRoomQueue("AB3K9Q", ["q2", "q1"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/AB3K9Q/queue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ intent: "reorder", orderedUpcomingIds: ["q2", "q1"] }),
      }),
    );
  });

  it("resolves leave/end room code from override, then live ref, then sessionStorage", () => {
    expect(
      resolveRoomActionCode({
        override: "AB3K9Q",
        refCode: "XXXXXX",
        storedCode: "YYYYYY",
      }),
    ).toBe("AB3K9Q");
    expect(resolveRoomActionCode({ override: null, refCode: "AB3K9Q", storedCode: "YYYYYY" })).toBe(
      "AB3K9Q",
    );
    expect(resolveRoomActionCode({ override: null, refCode: null, storedCode: "AB3K9Q" })).toBe(
      "AB3K9Q",
    );
    expect(resolveRoomActionCode({ override: "", refCode: null, storedCode: null })).toBeNull();
    expect(resolveRoomActionCode({})).toBeNull();
  });

  it("reportRoomPlayEvent posts to play-events", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    reportRoomPlayEvent("AB3K9Q", "room_play_started", "track-1", "play-xyz");
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/rooms/AB3K9Q/play-events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "room_play_started",
          trackId: "track-1",
          playId: "play-xyz",
        }),
      }),
    );
  });
});

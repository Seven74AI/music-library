/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { describe, expect, test } from "vitest";
import { server } from "#tests/mocks/index.ts";
import { useLock, type LockInfo } from "./use-lock";

const adaLock: LockInfo = {
  id: "lock-1",
  entityType: "track",
  entityId: "track-1",
  lockedBy: "ada-id",
  lockedByName: "Ada",
  acquiredAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:30:00.000Z",
};

describe("useLock", () => {
  test("treats acquire 409 as locked by the other curator", async () => {
    let statusReads = 0;
    let releaseCalls = 0;
    server.use(
      http.post("/api/locks/acquire", () =>
        HttpResponse.json(
          {
            error: "Already locked",
            message: "This entity is currently locked by another curator",
          },
          { status: 409 },
        ),
      ),
      http.get("/api/locks/status", () => {
        statusReads += 1;
        return HttpResponse.json({ lock: adaLock });
      }),
      http.post("/api/locks/release", () => {
        releaseCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { result, unmount } = renderHook(() => useLock("track", "track-1"));

    await waitFor(() => {
      expect(result.current.isLockedByOther).toBe(true);
    });
    expect(result.current.lock?.lockedByName).toBe("Ada");

    result.current.refresh();
    await waitFor(() => {
      expect(statusReads).toBeGreaterThanOrEqual(2);
    });
    expect(result.current.isLockedByOther).toBe(true);
    expect(result.current.lock?.lockedByName).toBe("Ada");

    await act(async () => {
      unmount();
    });
    expect(releaseCalls).toBe(0);
  });

  test("an acquired lock is ours and is released on unmount", async () => {
    const mine: LockInfo = { ...adaLock, lockedBy: "me", lockedByName: "Me" };
    let releaseCalls = 0;
    server.use(
      http.post("/api/locks/acquire", () => HttpResponse.json({ lock: mine })),
      http.post("/api/locks/release", () => {
        releaseCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { result, unmount } = renderHook(() => useLock("track", "track-1"));

    await waitFor(() => {
      expect(result.current.lock?.lockedBy).toBe("me");
    });
    expect(result.current.isLockedByOther).toBe(false);

    await act(async () => {
      unmount();
    });

    await waitFor(() => {
      expect(releaseCalls).toBe(1);
    });
  });

  test("refresh acquires once the other curator releases", async () => {
    let statusLock: LockInfo | null = adaLock;
    let releaseCalls = 0;
    server.use(
      http.post("/api/locks/acquire", () => {
        if (statusLock) {
          return HttpResponse.json({ message: "locked" }, { status: 409 });
        }
        return HttpResponse.json({
          lock: { ...adaLock, lockedBy: "me", lockedByName: "Me" },
        });
      }),
      http.get("/api/locks/status", () => HttpResponse.json({ lock: statusLock })),
      http.post("/api/locks/release", () => {
        releaseCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { result, unmount } = renderHook(() => useLock("track", "track-1"));

    await waitFor(() => {
      expect(result.current.isLockedByOther).toBe(true);
    });

    statusLock = null;
    result.current.refresh();

    await waitFor(() => {
      expect(result.current.isLockedByOther).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.lock?.lockedBy).toBe("me");
    });

    await act(async () => {
      unmount();
    });
    await waitFor(() => {
      expect(releaseCalls).toBe(1);
    });
  });

  test("releases the previous entity and locks the new id when the entity changes", async () => {
    const acquired: string[] = [];
    const released: string[] = [];
    server.use(
      http.post("/api/locks/acquire", async ({ request }) => {
        const body = (await request.json()) as { entityId: string };
        acquired.push(body.entityId);
        return HttpResponse.json({
          lock: {
            ...adaLock,
            entityId: body.entityId,
            lockedBy: "me",
            lockedByName: body.entityId === "track-1" ? "Ada" : "Me",
          },
        });
      }),
      http.post("/api/locks/release", async ({ request }) => {
        const body = (await request.json()) as { entityId: string };
        released.push(body.entityId);
        return HttpResponse.json({ success: true });
      }),
    );

    const { result, rerender, unmount } = renderHook(({ id }) => useLock("track", id), {
      initialProps: { id: "track-1" },
    });

    await waitFor(() => {
      expect(result.current.lock?.entityId).toBe("track-1");
    });
    expect(result.current.lock?.lockedByName).toBe("Ada");

    rerender({ id: "track-2" });

    await waitFor(() => {
      expect(result.current.lock?.entityId).toBe("track-2");
    });
    expect(result.current.lock?.lockedByName).toBe("Me");
    expect(result.current.lock?.entityId).not.toBe("track-1");
    expect(acquired).toEqual(["track-1", "track-2"]);
    expect(released).toContain("track-1");

    await act(async () => {
      unmount();
    });
  });
});

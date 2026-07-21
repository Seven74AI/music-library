import { describe, expect, test, vi, beforeEach } from "vitest";
import { requireUserId } from "#app/utils/auth.server.ts";
import { markAllNotificationsRead, markNotificationRead } from "#app/utils/notifications.server.ts";
import { action } from "./notifications.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/notifications.server.ts", () => ({
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

function makeRequest(formData: FormData) {
  return new Request("http://localhost/resources/notifications", {
    method: "POST",
    body: formData,
  });
}

/**
 * react-router v7's data() returns a DataWithResponseInit, not a plain
 * Response. The HTTP status lives in init.status (null = 200 OK).
 */
function expectStatus(response: unknown, expectedStatus: number) {
  const init = (response as { init?: { status?: number } | null }).init;
  const actual = init?.status ?? 200;
  expect(actual).toBe(expectedStatus);
}

describe("notifications action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("mark-all-read returns ok: true", async () => {
    vi.mocked(markAllNotificationsRead).mockResolvedValue(3);

    const formData = new FormData();
    formData.append("intent", "mark-all-read");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(markAllNotificationsRead).toHaveBeenCalledWith("user-1");
    expectStatus(response, 200);
    expect((response as { data: unknown }).data).toEqual({ ok: true });
  });

  test("mark-read with valid notificationId returns ok: true", async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(true);

    const formData = new FormData();
    formData.append("intent", "mark-read");
    formData.append("notificationId", "notif-123");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(markNotificationRead).toHaveBeenCalledWith("notif-123", "user-1");
    expectStatus(response, 200);
    expect((response as { data: unknown }).data).toEqual({ ok: true });
  });

  test("mark-read with missing notificationId returns 400", async () => {
    const formData = new FormData();
    formData.append("intent", "mark-read");
    // notificationId intentionally omitted

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(markNotificationRead).not.toHaveBeenCalled();
    expectStatus(response, 400);
    expect((response as { data: unknown }).data).toEqual({ ok: false });
  });

  test("mark-read for non-existent notification returns 404", async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(false);

    const formData = new FormData();
    formData.append("intent", "mark-read");
    formData.append("notificationId", "notif-nonexistent");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(markNotificationRead).toHaveBeenCalledWith("notif-nonexistent", "user-1");
    expectStatus(response, 404);
    expect((response as { data: unknown }).data).toEqual({ ok: false });
  });

  test("unknown intent returns 400", async () => {
    const formData = new FormData();
    formData.append("intent", "some-unknown-action");

    const response = await action({
      request: makeRequest(formData),
    } as never);

    expect(markAllNotificationsRead).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
    expectStatus(response, 400);
    expect((response as { data: unknown }).data).toEqual({ ok: false });
  });
});

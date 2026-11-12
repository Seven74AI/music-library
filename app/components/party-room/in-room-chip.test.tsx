/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InRoomChip, LeaveRoomButton } from "./in-room-chip.tsx";

const party = vi.hoisted(() => ({
  current: null as null | {
    isHost: boolean;
    leave: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    room: {
      code: string;
      status: string;
      me: { role: string } | null;
    };
  },
}));

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => party.current,
}));

function renderChip() {
  const router = createMemoryRouter([{ path: "/", element: <InRoomChip /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
}

describe("InRoomChip on a phone", () => {
  beforeEach(() => {
    party.current = {
      isHost: true,
      leave: vi.fn().mockResolvedValue(false),
      refresh: vi.fn().mockResolvedValue(undefined),
      room: { code: "LSQHE8", status: "open", me: { role: "host" } },
    };
  });

  test("keeps the room code visible and hides the role label below the sm breakpoint", () => {
    renderChip();

    expect(screen.getByRole("link", { name: /in room LSQHE8/i })).toBeInTheDocument();
    const role = screen.getByText("Host");
    expect(role.className).toMatch(/(?:^|\s)hidden(?:\s|$)/);
    expect(role.className).toContain("sm:inline");
  });

  test("hides a listener role the same way so the header avatar stays on screen", () => {
    party.current = {
      isHost: false,
      leave: vi.fn(),
      refresh: vi.fn(),
      room: { code: "LSQHE8", status: "open", me: { role: "listener" } },
    };
    renderChip();

    const role = screen.getByText("listener");
    expect(role.className).toMatch(/(?:^|\s)hidden(?:\s|$)/);
    expect(role.className).toContain("sm:inline");
  });
});

describe("LeaveRoomButton", () => {
  beforeEach(() => {
    party.current = {
      isHost: false,
      leave: vi.fn().mockResolvedValue(false),
      refresh: vi.fn().mockResolvedValue(undefined),
      room: { code: "LSQHE8", status: "open", me: { role: "listener" } },
    };
  });

  test("refreshes room state when leave fails", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: "/", element: <LeaveRoomButton /> }], {
      initialEntries: ["/"],
    });
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => {
      expect(party.current?.leave).toHaveBeenCalled();
      expect(party.current?.refresh).toHaveBeenCalled();
    });
  });
});

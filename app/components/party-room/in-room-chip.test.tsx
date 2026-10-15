/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InRoomChip } from "./in-room-chip.tsx";

const party = vi.hoisted(() => ({
  current: null as null | {
    isHost: boolean;
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
      room: { code: "LSQHE8", status: "open", me: { role: "listener" } },
    };
    renderChip();

    const role = screen.getByText("listener");
    expect(role.className).toMatch(/(?:^|\s)hidden(?:\s|$)/);
    expect(role.className).toContain("sm:inline");
  });
});

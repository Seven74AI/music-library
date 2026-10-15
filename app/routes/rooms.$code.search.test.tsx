/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import GuestSearchTab from "./rooms.$code.search.tsx";

const leave = vi.fn();
const refresh = vi.fn();

let mockParty: {
  room: null | {
    code: string;
    status: string;
    me: { id: string; role: string; displayName: string; userId: null };
    participants: Array<{ id: string }>;
    queue: [];
  };
  loading: boolean;
  canAddTracks: boolean;
  error: null;
  refresh: typeof refresh;
  leave: typeof leave;
};

vi.mock("#app/features/party-room/party-room-provider.tsx", () => ({
  useOptionalPartyRoom: () => mockParty,
  usePartyRoom: () => mockParty,
}));

const track = {
  id: "t1",
  type: "track" as const,
  title: "Shared Song",
  artistName: "Artist",
  artistId: "a1",
  relevance: 1,
};

function renderSearch(loaderRole: "listener" | "dj") {
  function SearchHarness() {
    const [, bump] = useState(0);
    return (
      <>
        <button type="button" onClick={() => bump((n) => n + 1)}>
          Sync seat
        </button>
        <GuestSearchTab />
      </>
    );
  }

  const router = createMemoryRouter(
    [
      {
        path: "/rooms/:code/search",
        HydrateFallback: () => null,
        Component: SearchHarness,
        loader: () => ({
          code: "AB3K9Q",
          role: loaderRole,
          canAddTracks: loaderRole !== "listener",
          displayName: "Walkup",
        }),
      },
    ],
    { initialEntries: ["/rooms/AB3K9Q/search"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("guest search follows the live seat", () => {
  beforeEach(() => {
    refresh.mockReset();
    leave.mockReset();
    mockParty = {
      room: {
        code: "AB3K9Q",
        status: "open",
        me: { id: "g1", role: "listener", displayName: "Walkup", userId: null },
        participants: [{ id: "g1" }],
        queue: [],
      },
      loading: false,
      canAddTracks: false,
      error: null,
      refresh,
      leave,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [track] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  test("Add appears when the live seat is DJ even if the loader seat is Listener", async () => {
    mockParty = {
      ...mockParty,
      canAddTracks: true,
      room: {
        ...mockParty.room!,
        me: { ...mockParty.room!.me, role: "dj" },
      },
    };
    renderSearch("listener");

    expect(await screen.findByText(/add to queue from your role/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search artists/i), {
      target: { value: "song" },
    });
    expect(await screen.findByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audition" })).toBeInTheDocument();
  });

  test("Add goes away when the live seat is demoted without a reload", async () => {
    mockParty = {
      ...mockParty,
      canAddTracks: true,
      room: {
        ...mockParty.room!,
        me: { ...mockParty.room!.me, role: "dj" },
      },
    };
    renderSearch("dj");
    fireEvent.change(await screen.findByPlaceholderText(/search artists/i), {
      target: { value: "song" },
    });
    expect(await screen.findByRole("button", { name: "Add" })).toBeInTheDocument();

    mockParty = {
      ...mockParty,
      canAddTracks: false,
      room: {
        ...mockParty.room!,
        me: { ...mockParty.room!.me, role: "listener" },
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "Sync seat" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Audition" })).toBeInTheDocument();
    expect(screen.getByText(/add requires DJ\/Host/i)).toBeInTheDocument();
  });
});

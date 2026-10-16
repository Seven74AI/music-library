/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import GuestSearchTab from "./rooms.$code.search._index.tsx";
import GuestSearchLayout from "./rooms.$code.search.tsx";

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
  albumName: "Shared Album",
  albumId: "album-1",
  duration: 180,
  relevance: 1,
};

const loveAlbum = {
  id: "album-love",
  type: "album" as const,
  name: "Love Album",
  artistName: "Tester",
  artistId: "artist-1",
  year: 1999,
  relevance: 1,
};

const loveArtist = {
  id: "artist-1",
  type: "artist" as const,
  name: "Tester",
  genre: "Pop",
  relevance: 2,
};

const extraTrack = {
  ...track,
  id: "t2",
  title: "Second Song",
};

function searchResponse(results: unknown[], nextCursor: string | null = null) {
  return new Response(
    JSON.stringify({
      results,
      pagination: { limit: 20, hasNext: Boolean(nextCursor), nextCursor },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function installFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/audition")) {
      return new Response(
        JSON.stringify({
          grantId: "grant-1",
          audioUrl: "/resources/audition/grant-1",
          track: { title: "Shared Song", artistName: "Artist" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const q = url.searchParams.get("q");
    if (q === "love") return searchResponse([loveAlbum, loveArtist]);
    if (url.searchParams.get("cursor")) return searchResponse([extraTrack]);
    if (q === "more") return searchResponse([track], "cursor-2");
    return searchResponse(q ? [track] : []);
  });
}

function renderSearch(loaderRole: "listener" | "dj", initialEntry = "/rooms/AB3K9Q/search") {
  function SearchHarness() {
    const [, bump] = useState(0);
    return (
      <>
        <button type="button" onClick={() => bump((n) => n + 1)}>
          Sync seat
        </button>
        <GuestSearchLayout />
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
        children: [{ index: true, Component: GuestSearchTab }],
      },
      { path: "/rooms/:code/search/albums/:albumId", element: <p>Opened album</p> },
      { path: "/rooms/:code/search/artists/:artistId", element: <p>Opened artist</p> },
    ],
    { initialEntries: [initialEntry] },
  );

  return { router, ...render(<RouterProvider router={router} />) };
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
    installFetch();
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
    expect(
      await screen.findByRole("button", { name: /add shared song to the room queue/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /audition shared song/i })).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: /add shared song to the room queue/i }),
    ).toBeInTheDocument();

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
      expect(
        screen.queryByRole("button", { name: /add shared song to the room queue/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /audition shared song/i })).toBeInTheDocument();
    expect(screen.getByText(/add requires DJ\/Host/i)).toBeInTheDocument();
  });
});

describe("guest search catalog browsing", () => {
  beforeEach(() => {
    mockParty = {
      room: {
        code: "AB3K9Q",
        status: "open",
        me: { id: "g1", role: "dj", displayName: "Walkup", userId: null },
        participants: [{ id: "g1" }],
        queue: [],
      },
      loading: false,
      canAddTracks: true,
      error: null,
      refresh,
      leave,
    };
    installFetch();
  });

  test("does not cover the page with an audition bar before a track is playing", async () => {
    renderSearch("dj");
    expect(await screen.findByPlaceholderText(/search artists/i)).toBeInTheDocument();
    expect(screen.queryByText(/audition plays one track on this device/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  test("opens album and artist pages and links a track to both", async () => {
    const { router } = renderSearch("dj");
    fireEvent.change(await screen.findByPlaceholderText(/search artists/i), {
      target: { value: "love" },
    });

    const album = await screen.findByRole("link", { name: /love album/i });
    expect(album).toHaveAttribute("href", "/rooms/AB3K9Q/search/albums/album-love");
    expect(screen.getByRole("link", { name: /^tester/i })).toHaveAttribute(
      "href",
      "/rooms/AB3K9Q/search/artists/artist-1",
    );

    fireEvent.click(album);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/rooms/AB3K9Q/search/albums/album-love");
    });
  });

  test("links the track artist and album, and filters the request", async () => {
    const fetchMock = installFetch();
    const { router } = renderSearch("dj");
    fireEvent.change(await screen.findByPlaceholderText(/search artists/i), {
      target: { value: "song" },
    });

    expect(await screen.findByRole("link", { name: "Artist" })).toHaveAttribute(
      "href",
      "/rooms/AB3K9Q/search/artists/a1",
    );
    expect(screen.getByRole("link", { name: "Shared Album" })).toHaveAttribute(
      "href",
      "/rooms/AB3K9Q/search/albums/album-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Albums" }));
    expect(screen.getByRole("button", { name: "Albums" })).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("type=albums") && url.includes("q=song"))).toBe(true);
    });
    expect(router.state.location.search).toContain("q=song");
    expect(router.state.location.search).toContain("type=albums");
  });

  test("shows searching while a url query is still loading", async () => {
    let release: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderSearch("dj", "/rooms/AB3K9Q/search?q=love&type=albums");

    expect(await screen.findByPlaceholderText(/search artists/i)).toHaveValue("love");
    expect(screen.getByText(/^searching/i)).toBeInTheDocument();
    expect(screen.queryByText(/no playable matches/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(release).toBeTypeOf("function");
    });
    release?.(searchResponse([loveAlbum]));
    expect(await screen.findByRole("link", { name: /love album/i })).toBeInTheDocument();
  });

  test("restores a search opened from the url and clears it", async () => {
    const fetchMock = installFetch();
    renderSearch("dj", "/rooms/AB3K9Q/search?q=love&type=albums");

    expect(await screen.findByRole("link", { name: /love album/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Albums" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("type=albums") && url.includes("q=love"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(screen.getByPlaceholderText(/search artists/i)).toHaveValue("");
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /love album/i })).not.toBeInTheDocument();
    });
  });

  test("loads another page of matches", async () => {
    const fetchMock = installFetch();
    renderSearch("dj");
    fireEvent.change(await screen.findByPlaceholderText(/search artists/i), {
      target: { value: "more" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Second Song")).toBeInTheDocument();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("cursor=cursor-2"))).toBe(true);
    });
  });

  test("shows the audition player only after audition starts", async () => {
    renderSearch("dj");
    fireEvent.change(await screen.findByPlaceholderText(/search artists/i), {
      target: { value: "song" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /audition shared song/i }));
    const stop = await screen.findByRole("button", { name: "Stop" });
    expect(stop).toBeInTheDocument();
    expect(screen.getByText(/audition on this device/i)).toBeInTheDocument();
    const dock = screen.getByTestId("room-audition-dock");
    expect(dock).toHaveClass("z-52");
    expect(dock.style.bottom).toBe("var(--install-banner-height, 0px)");
  });
});

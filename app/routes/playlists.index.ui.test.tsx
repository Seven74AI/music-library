/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { Outlet, createRoutesStub } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import PlaylistsIndexRoute from "./playlists.index.tsx";

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => ({
    playUserPlaylist: vi.fn(),
  }),
}));

type Entry = { isIntersecting: boolean };
type ObserverCallback = (entries: Entry[]) => void;

let observers: ObserverCallback[] = [];

class MockIntersectionObserver {
  callback: ObserverCallback;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    observers.push(callback);
  }

  observe() {}

  unobserve() {}

  disconnect() {}
}

type LoadCall = { routeId: string; url: string };

function playlist(id: string, title: string) {
  const updatedAt = new Date("2026-10-24T12:00:00.000Z");
  return {
    id,
    title,
    description: null,
    createdAt: updatedAt,
    updatedAt,
    tracks: [],
  };
}

const page1 = {
  playlists: [playlist("pl-14", "QA-SCROLL-PL-14")],
  pagination: { limit: 12, hasNext: true, nextCursor: "pl-03" },
  sort: "updated",
  direction: "desc",
  q: "",
};

const page2 = {
  playlists: [playlist("pl-02", "QA-SCROLL-PL-02")],
  pagination: { limit: 12, hasNext: false, nextCursor: null },
  sort: "updated",
  direction: "desc",
  q: "",
};

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
});

function renderPlaylists() {
  const calls: LoadCall[] = [];
  const Stub = createRoutesStub([
    {
      id: "routes/playlists",
      path: "/playlists",
      loader: ({ request }) => {
        calls.push({ routeId: "routes/playlists", url: request.url });
        return {};
      },
      Component: () => <Outlet />,
      HydrateFallback: () => null,
      children: [
        {
          id: "routes/playlists.index",
          index: true,
          HydrateFallback: () => null,
          loader: ({ request }) => {
            calls.push({ routeId: "routes/playlists.index", url: request.url });
            const cursor = new URL(request.url).searchParams.get("cursor");
            return cursor ? page2 : page1;
          },
          Component: PlaylistsIndexRoute,
        },
      ],
    },
  ]);

  const view = render(<Stub initialEntries={["/playlists"]} />);
  return { calls, ...view };
}

test("next playlist page load targets the index route", async () => {
  const { calls } = renderPlaylists();

  expect(await screen.findByText("QA-SCROLL-PL-14")).toBeInTheDocument();
  expect(screen.getByText("Scroll to load more")).toBeInTheDocument();

  await waitFor(() => {
    expect(observers.length).toBeGreaterThan(0);
  });

  observers.at(-1)!([{ isIntersecting: true }]);

  await waitFor(() => {
    expect(calls.some((call) => new URL(call.url).searchParams.has("cursor"))).toBe(true);
  });

  const next = calls.find((call) => new URL(call.url).searchParams.has("cursor"));
  const nextUrl = new URL(next!.url);
  expect(`${nextUrl.pathname}${nextUrl.search}`).toBe(
    "/playlists?index&cursor=pl-03&limit=12&sort=updated",
  );
  expect(next?.routeId).toBe("routes/playlists.index");
  expect(
    calls.some(
      (call) => call.routeId === "routes/playlists" && new URL(call.url).searchParams.has("cursor"),
    ),
  ).toBe(false);

  expect(await screen.findByText("QA-SCROLL-PL-02")).toBeInTheDocument();
});

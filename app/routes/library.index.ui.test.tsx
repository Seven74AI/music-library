/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, expect, test, vi } from "vitest";
import LibraryIndexRoute from "./library.index.tsx";

vi.mock("#app/components/track-list-item", () => ({
  TrackListItem: ({ track }: { track: { title: string } }) => <div>{track.title}</div>,
}));

vi.mock("#app/components/bulk-edit-dialog", () => ({
  BulkEditDialog: () => null,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

function renderLibrary(loaderData: Record<string, unknown>, url = "/library") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/library",
        element: <LibraryIndexRoute loaderData={loaderData as never} />,
      },
    ],
    { initialEntries: [url] },
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const baseLoaderData = {
  userTracks: [],
  pagination: { hasNext: false, nextCursor: null, limit: 50 },
  hasAudioOnly: false,
  sort: "dateAdded",
  direction: "desc",
  playlists: [],
  isCurator: false,
  genreId: null,
  genre: null,
};

test("shows an empty state when the genre filter matches no library tracks", async () => {
  renderLibrary({
    ...baseLoaderData,
    genreId: "genre-jazz",
    genre: { id: "genre-jazz", name: "Jazz" },
  });

  expect(
    await screen.findByRole("heading", { name: "No tracks tagged with Jazz" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "No tracks yet" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Clear filter" })).toHaveAttribute("href", "/library");
});

test("says the genre filter matches nothing when the genre id is unknown", async () => {
  renderLibrary(
    {
      ...baseLoaderData,
      genreId: "missing-genre",
      genre: null,
    },
    "/library?hasAudio=1&genre=missing-genre",
  );

  expect(
    await screen.findByRole("heading", { name: "No tracks match this genre" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Clear filter" })).toHaveAttribute(
    "href",
    "/library?hasAudio=1",
  );
});

test("keeps the unfiltered empty library copy", async () => {
  renderLibrary(baseLoaderData);

  expect(await screen.findByRole("heading", { name: "No tracks yet" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Clear filter" })).not.toBeInTheDocument();
});

test("names the active genre when matching tracks are shown", async () => {
  renderLibrary({
    ...baseLoaderData,
    genreId: "genre-jazz",
    genre: { id: "genre-jazz", name: "Jazz" },
    userTracks: [
      {
        id: "ut-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        track: {
          id: "track-1",
          title: "Kind of Blue",
          artist: { id: "artist-1", name: "Miles Davis" },
          duration: 180,
          coverImage: null,
          serviceUrl: null,
          audioFiles: [],
        },
      },
    ],
  });

  expect(await screen.findByText(/Showing tracks tagged with/)).toBeInTheDocument();
  expect(screen.getByText("Jazz")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "No tracks tagged with Jazz" }),
  ).not.toBeInTheDocument();
});

function libraryUserTrack(id: string, title: string) {
  return {
    id: `ut-${id}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    track: {
      id,
      title,
      artist: { id: "artist-1", name: "Miles Davis" },
      duration: 180,
      coverImage: null,
      serviceUrl: null,
      audioFiles: [],
    },
  };
}

test("scrolls library tracks with the page and keeps row spacing at the real row height", async () => {
  renderLibrary({
    ...baseLoaderData,
    userTracks: [
      libraryUserTrack("track-1", "Kind of Blue"),
      libraryUserTrack("track-2", "So What"),
    ],
  });

  const list = await screen.findByTestId("library-track-list");
  expect(list.querySelector("[data-radix-scroll-area-viewport]")).toBeNull();

  const first = list.querySelector<HTMLElement>("[data-index='1']");
  const second = list.querySelector<HTMLElement>("[data-index='2']");
  expect(first?.style.transform).toBe("translateY(64px)");
  expect(second?.style.transform).toBe("translateY(144px)");
  expect(
    list.querySelector<HTMLElement>("[data-testid='library-virtual-spacer']")?.style.height,
  ).toBe("224px");
});

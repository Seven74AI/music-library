/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { type SearchResult } from "#app/types/search.ts";
import { SearchResults } from "./search-results";

type Entry = { isIntersecting: boolean };
type ObserverCallback = (entries: Entry[], observer: unknown) => void;

let observers: Array<{ callback: ObserverCallback; element: Element | null }> = [];

class MockIntersectionObserver {
  callback: ObserverCallback;
  element: Element | null = null;

  constructor(callback: ObserverCallback, _options?: IntersectionObserverInit) {
    this.callback = callback;
    observers.push(this);
  }

  observe(element: Element) {
    this.element = element;
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

const trackListItemMock = vi.fn();

vi.mock("#app/components/track-list-item.tsx", () => ({
  TrackListItem: ({
    track,
    showQuickAddToPlaylist,
    playlistContext,
  }: {
    track: { title: string };
    showQuickAddToPlaylist?: boolean;
    playlistContext?: { type: string; trackId?: string };
  }) =>
    (() => {
      trackListItemMock({ track, showQuickAddToPlaylist, playlistContext });
      return (
        <div data-testid="track-list-item">
          <span>{track.title}</span>
          {showQuickAddToPlaylist ? (
            <button type="button" aria-label="Add to playlist">
              +
            </button>
          ) : null}
          <button type="button" aria-label="More actions">
            ...
          </button>
        </div>
      );
    })(),
}));

const mixedResults: SearchResult[] = [
  {
    type: "track",
    id: "track-1",
    title: "Search Track",
    artistName: "Search Artist",
    artistId: "artist-1",
    relevance: 1,
    audioFiles: [],
  },
  {
    type: "artist",
    id: "artist-1",
    name: "Search Artist",
    relevance: 2,
  },
  {
    type: "album",
    id: "album-1",
    name: "Search Album",
    artistName: "Search Artist",
    artistId: "artist-1",
    relevance: 3,
  },
];

function renderSearchResults(results: SearchResult[] = mixedResults) {
  return render(
    <MemoryRouter>
      <SearchResults results={results} query="search" playlists={[]} />
    </MemoryRouter>,
  );
}

test("renders track results with track list item instead of links", () => {
  trackListItemMock.mockClear();
  renderSearchResults();

  expect(screen.getByTestId("track-list-item")).toBeDefined();
  expect(screen.getByText("Search Track")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add to playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "More actions" })).toBeDefined();
});

test("uses one-track playback context for search track results", () => {
  trackListItemMock.mockClear();

  renderSearchResults();

  expect(trackListItemMock).toHaveBeenCalledWith(
    expect.objectContaining({
      playlistContext: { type: "track", trackId: "track-1" },
    }),
  );
});

test("keeps artist and album results as navigational links", () => {
  renderSearchResults();

  const links = screen.getAllByRole("link");
  expect(links.some((link) => link.getAttribute("href") === "/artists/artist-1")).toBe(true);
  expect(links.some((link) => link.getAttribute("href") === "/albums/album-1")).toBe(true);
});

test("renders empty state safely when results are omitted", () => {
  render(
    <MemoryRouter>
      <SearchResults query="-" playlists={[]} />
    </MemoryRouter>,
  );

  expect(screen.getByText("No results found")).toBeDefined();
});

test("triggers onLoadMore when the infinite-scroll sentinel enters the viewport", () => {
  const onLoadMore = vi.fn();
  render(
    <MemoryRouter>
      <SearchResults
        results={mixedResults}
        query="search"
        playlists={[]}
        onLoadMore={onLoadMore}
        hasNext
      />
    </MemoryRouter>,
  );

  expect(observers).toHaveLength(1);
  expect(observers[0]!.element).not.toBeNull();

  observers[0]!.callback([{ isIntersecting: true }], observers[0]!);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

test("shows a spinner instead of a Load More button while the next page loads", () => {
  const onLoadMore = vi.fn();
  render(
    <MemoryRouter>
      <SearchResults
        results={mixedResults}
        query="search"
        playlists={[]}
        onLoadMore={onLoadMore}
        hasNext
        isLoading
      />
    </MemoryRouter>,
  );

  expect(screen.queryByRole("button", { name: "Load More" })).toBeNull();
  expect(screen.getByTestId("infinite-scroll-sentinel")).toBeDefined();

  // While loading the observer is disabled so it can't re-trigger onLoadMore.
  expect(observers).toHaveLength(0);
});

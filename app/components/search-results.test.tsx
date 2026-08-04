/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { type SearchResult } from "#app/types/search.ts";
import { SearchResults } from "./search-results";

vi.mock("#app/components/track-list-item.tsx", () => ({
  TrackListItem: ({
    track,
    showQuickAddToPlaylist,
  }: {
    track: { title: string };
    showQuickAddToPlaylist?: boolean;
  }) => (
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
  ),
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
  renderSearchResults();

  expect(screen.getByTestId("track-list-item")).toBeDefined();
  expect(screen.getByText("Search Track")).toBeDefined();
  expect(screen.getByRole("button", { name: "Add to playlist" })).toBeDefined();
  expect(screen.getByRole("button", { name: "More actions" })).toBeDefined();
});

test("keeps artist and album results as navigational links", () => {
  renderSearchResults();

  const links = screen.getAllByRole("link");
  expect(links.some((link) => link.getAttribute("href") === "/artists/artist-1")).toBe(true);
  expect(links.some((link) => link.getAttribute("href") === "/albums/album-1")).toBe(true);
});

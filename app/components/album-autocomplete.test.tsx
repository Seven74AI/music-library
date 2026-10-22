/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AlbumAutocomplete } from "./album-autocomplete";

const searchLoad = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const React = await import("react");
  return {
    ...actual,
    useFetcher: () => {
      const [data, setData] = React.useState<
        | {
            albums: Array<{
              id: string;
              name: string;
              artistName: string;
              year: number | null;
              trackCount: number;
            }>;
          }
        | undefined
      >(undefined);
      return {
        state: "idle" as const,
        data,
        load: (url: string) => {
          searchLoad(url);
          const query = new URL(url, "http://localhost").searchParams.get("q") ?? "";
          setData({
            albums:
              query === "missing"
                ? []
                : query
                  ? [
                      {
                        id: "album-blue",
                        name: `Match ${query}`,
                        artistName: "Miles Davis",
                        year: 1959,
                        trackCount: 5,
                      },
                    ]
                  : [],
          });
        },
        submit: vi.fn(),
      };
    },
  };
});

const albumsById: Record<
  string,
  { id: string; name: string; artistName: string; year: number | null; trackCount: number }
> = {
  "album-ozoror": {
    id: "album-ozoror",
    name: "Ozoror",
    artistName: "Meryl",
    year: 2023,
    trackCount: 4,
  },
  "album-blue": {
    id: "album-blue",
    name: "Kind of Blue",
    artistName: "Miles Davis",
    year: 1959,
    trackCount: 5,
  },
};

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const url = String(input);
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    const album = albumsById[id];
    if (!album) {
      return new Response(JSON.stringify({ album: null }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ album }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  searchLoad.mockReset();
  installFetchMock();
});

function albumInput() {
  return screen.getByRole("textbox", { name: /^album$/i });
}

test("shows a parent-supplied album name immediately and does not fetch", async () => {
  const onChange = vi.fn();
  const fetchMock = vi.mocked(fetch);
  render(<AlbumAutocomplete value="album-ozoror" albumName="Ozoror" onChange={onChange} />);

  expect(albumInput()).toHaveValue("Ozoror");
  expect(albumInput()).toBeEnabled();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test("looks up the album name when only an id is provided", async () => {
  const onChange = vi.fn();
  render(<AlbumAutocomplete value="album-blue" onChange={onChange} />);

  expect(await screen.findByDisplayValue("Kind of Blue")).toBe(albumInput());
  expect(onChange).not.toHaveBeenCalled();
});

test("selecting a search result reports that album and shows the name", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AlbumAutocomplete value={null} onChange={onChange} />);

  await user.type(albumInput(), "Nova");
  await user.click(await screen.findByRole("button", { name: /Match Nova/ }));

  expect(searchLoad).toHaveBeenCalledWith("/api/albums/search?q=Nova");
  expect(onChange).toHaveBeenCalledWith("album-blue", "Match Nova");
  expect(albumInput()).toHaveValue("Match Nova");
});

test("does not offer to create an album when nothing matches", async () => {
  const user = userEvent.setup();
  render(<AlbumAutocomplete value={null} onChange={vi.fn()} />);

  await user.type(albumInput(), "missing");

  expect(await screen.findByText("No matching albums")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
});

test("clears the album when the user empties the field", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AlbumAutocomplete value="album-ozoror" albumName="Ozoror" onChange={onChange} />);

  await user.clear(albumInput());

  expect(onChange).toHaveBeenCalledWith(null, "");
  expect(albumInput()).toHaveValue("");
});

test("controlled parent can show the selected album after onChange", async () => {
  const user = userEvent.setup();

  function Harness() {
    const [albumId, setAlbumId] = useState<string | null>(null);
    const [albumName, setAlbumName] = useState<string | null>(null);
    return (
      <AlbumAutocomplete
        value={albumId}
        albumName={albumName}
        onChange={(id, name) => {
          setAlbumId(id);
          setAlbumName(name);
        }}
      />
    );
  }

  render(<Harness />);
  await user.type(albumInput(), "Nova");
  await user.click(await screen.findByRole("button", { name: /Match Nova/ }));

  expect(albumInput()).toHaveValue("Match Nova");
});

test("does not clear the album when lookup fails", async () => {
  const onChange = vi.fn();
  render(<AlbumAutocomplete value="missing-album" onChange={onChange} />);

  await waitFor(() => {
    expect(fetch).toHaveBeenCalled();
  });

  expect(albumInput()).toHaveValue("");
  expect(onChange).not.toHaveBeenCalled();
});

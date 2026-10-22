/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { ArtistAutocomplete } from "./artist-autocomplete";

const searchLoad = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const React = await import("react");
  return {
    ...actual,
    useFetcher: () => {
      const [data, setData] = React.useState<
        { artists: Array<{ id: string; name: string; trackCount: number }> } | undefined
      >(undefined);
      return {
        state: "idle" as const,
        data,
        load: (url: string) => {
          searchLoad(url);
          const query = new URL(url, "http://localhost").searchParams.get("q") ?? "";
          setData({
            artists: query ? [{ id: "artist-new", name: `Match ${query}`, trackCount: 2 }] : [],
          });
        },
        submit: vi.fn(),
      };
    },
  };
});

const artistsById: Record<string, { id: string; name: string; trackCount: number }> = {
  "artist-meryl": { id: "artist-meryl", name: "Meryl", trackCount: 4 },
  "artist-other": { id: "artist-other", name: "Other Artist", trackCount: 1 },
};

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const url = String(input);
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    const artist = artistsById[id];
    if (!artist) {
      return new Response(JSON.stringify({ artist: null }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ artist }), {
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

function artistInput() {
  return screen.getByRole("textbox", { name: /artist/i });
}

test("shows the artist name for the provided id without clearing it", async () => {
  const onChange = vi.fn();
  render(<ArtistAutocomplete value="artist-meryl" onChange={onChange} />);

  expect(await screen.findByDisplayValue("Meryl")).toBe(artistInput());
  expect(onChange).not.toHaveBeenCalled();

  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(searchLoad).not.toHaveBeenCalled();
});

test("shows a parent-supplied artist name immediately and does not fetch", async () => {
  const onChange = vi.fn();
  const fetchMock = vi.mocked(fetch);
  render(
    <ArtistAutocomplete value="artist-meryl" artistName="Meryl" onChange={onChange} required />,
  );

  expect(artistInput()).toHaveValue("Meryl");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test("updates the visible artist when the parent id changes", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<ArtistAutocomplete value="artist-meryl" onChange={onChange} />);

  expect(await screen.findByDisplayValue("Meryl")).toBeInTheDocument();

  rerender(<ArtistAutocomplete value="artist-other" onChange={onChange} />);

  expect(await screen.findByDisplayValue("Other Artist")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

test("follows a parent id change even if the user had started typing", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <ArtistAutocomplete value="artist-meryl" artistName="Meryl" onChange={onChange} />,
  );

  await user.type(artistInput(), "x");
  expect(artistInput()).toHaveValue("Merylx");

  rerender(
    <ArtistAutocomplete value="artist-other" artistName="Other Artist" onChange={onChange} />,
  );

  expect(artistInput()).toHaveValue("Other Artist");
  expect(onChange).not.toHaveBeenCalled();
});

test("clears the visible name when the parent clears the id without echoing onChange", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ArtistAutocomplete value="artist-meryl" artistName="Meryl" onChange={onChange} />,
  );

  expect(artistInput()).toHaveValue("Meryl");

  rerender(<ArtistAutocomplete value={null} artistName={null} onChange={onChange} />);

  expect(artistInput()).toHaveValue("");
  expect(onChange).not.toHaveBeenCalled();
});

test("leaves the field empty and keeps the id when no artist name is known yet", () => {
  const onChange = vi.fn();
  render(<ArtistAutocomplete value={null} onChange={onChange} />);

  expect(artistInput()).toHaveValue("");
  expect(artistInput()).toHaveAttribute("placeholder", "Search or create artist...");
  expect(onChange).not.toHaveBeenCalled();
});

test("does not clear the artist when lookup fails", async () => {
  const onChange = vi.fn();
  render(<ArtistAutocomplete value="missing-artist" onChange={onChange} />);

  await waitFor(() => {
    expect(fetch).toHaveBeenCalled();
  });

  expect(artistInput()).toHaveValue("");
  expect(onChange).not.toHaveBeenCalled();
});

test("does not clear the artist when the user edits the name without emptying it", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ArtistAutocomplete value="artist-meryl" artistName="Meryl" onChange={onChange} />);

  await user.type(artistInput(), "{backspace}");

  expect(artistInput()).toHaveValue("Mery");
  expect(onChange).not.toHaveBeenCalled();
});

test("clears the artist when the user empties the field", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ArtistAutocomplete value="artist-meryl" artistName="Meryl" onChange={onChange} />);

  await user.clear(artistInput());

  expect(onChange).toHaveBeenCalledWith(null, "");
  expect(artistInput()).toHaveValue("");
});

test("selecting a search result reports that artist and shows the name", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ArtistAutocomplete value={null} onChange={onChange} />);

  await user.type(artistInput(), "Nova");
  await user.click(await screen.findByRole("button", { name: /Match Nova/ }));

  expect(onChange).toHaveBeenCalledWith("artist-new", "Match Nova");
  expect(artistInput()).toHaveValue("Match Nova");
});

test("keeps a bulk-edit selection in sync when the parent artist id changes", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ArtistAutocomplete value={null} onChange={onChange} label="Artist" />,
  );

  expect(artistInput()).toHaveValue("");
  expect(onChange).not.toHaveBeenCalled();

  rerender(
    <ArtistAutocomplete
      value="artist-meryl"
      artistName="Meryl"
      onChange={onChange}
      label="Artist"
    />,
  );

  expect(artistInput()).toHaveValue("Meryl");
  expect(onChange).not.toHaveBeenCalled();
});

test("controlled parent can show the selected artist after onChange", async () => {
  const user = userEvent.setup();

  function Harness() {
    const [artistId, setArtistId] = useState<string | null>(null);
    const [artistName, setArtistName] = useState<string | null>(null);
    return (
      <ArtistAutocomplete
        value={artistId}
        artistName={artistName}
        onChange={(id, name) => {
          setArtistId(id);
          setArtistName(name);
        }}
      />
    );
  }

  render(<Harness />);
  await user.type(artistInput(), "Nova");
  await user.click(await screen.findByRole("button", { name: /Match Nova/ }));

  expect(artistInput()).toHaveValue("Match Nova");
});

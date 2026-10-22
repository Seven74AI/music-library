/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { type TrackDetails } from "../track-details-dialog";
import { BasicMetadataTab } from "./basic-metadata-tab";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const React = await import("react");
  return {
    ...actual,
    useFetcher: () => {
      const [data, setData] = React.useState<
        | {
            albums?: Array<{
              id: string;
              name: string;
              artistName: string;
              year: number | null;
              trackCount: number;
            }>;
            genres?: Array<{ id: string; name: string; trackCount: number }>;
          }
        | undefined
      >(undefined);
      return {
        state: "idle" as const,
        data,
        load: (url: string) => {
          if (url.startsWith("/api/albums/search")) {
            const query = new URL(url, "http://localhost").searchParams.get("q") ?? "";
            setData({
              albums: query
                ? [
                    {
                      id: "album-blue",
                      name: "Kind of Blue",
                      artistName: "Miles Davis",
                      year: 1959,
                      trackCount: 5,
                    },
                  ]
                : [],
            });
            return;
          }
          setData({ genres: [] });
        },
        submit: vi.fn(),
      };
    },
  };
});

const track: TrackDetails = {
  id: "track-coca",
  title: "Coca-Cola Mentos",
  artist: { id: "artist-meryl", name: "Meryl" },
  albumRecord: { id: "album-ozoror", name: "Ozoror" },
  duration: 180,
  createdAt: "2023-01-01T00:00:00.000Z",
  releaseDate: null,
  originalDate: null,
  coverImage: null,
  service: null,
  serviceUrl: null,
  genre: null,
  genres: [],
  year: 2023,
  trackNumber: null,
  albumArtist: null,
  bpm: null,
  label: null,
  isrc: null,
  originalYear: null,
  totalTracks: null,
  totalDiscs: null,
  lyrics: null,
};

function renderTab(onSave = vi.fn()) {
  render(<BasicMetadataTab track={track} onSave={onSave} />);
  return onSave;
}

test("disables artist, genres, and year while another curator holds the lock", () => {
  render(<BasicMetadataTab track={track} onSave={vi.fn()} disabled />);

  expect(screen.getByRole("textbox", { name: /^title/i })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /artist/i })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /^album$/i })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: /genres/i })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: /year/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
});

test("shows the track artist name in the required Artist field", () => {
  renderTab();

  expect(screen.getByRole("textbox", { name: /artist/i })).toHaveValue("Meryl");
  expect(screen.getByRole("textbox", { name: /^title/i })).toHaveValue("Coca-Cola Mentos");
  const album = screen.getByRole("textbox", { name: /^album$/i });
  expect(album).toHaveValue("Ozoror");
  expect(album).toBeEnabled();
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: /year/i })).toHaveValue(2023);
});

test("a title-only save keeps the existing artist id", async () => {
  const user = userEvent.setup();
  const onSave = renderTab();

  await user.type(screen.getByRole("textbox", { name: /^title/i }), "!");
  await user.click(screen.getByRole("button", { name: /save changes/i }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Coca-Cola Mentos!",
      artistId: "artist-meryl",
      albumId: "album-ozoror",
    }),
  );
});

test("saving after the user clears the artist requires an artist", async () => {
  const user = userEvent.setup();
  const onSave = renderTab();

  await user.clear(screen.getByRole("textbox", { name: /artist/i }));
  await user.type(screen.getByRole("textbox", { name: /^title/i }), "!");
  await user.click(screen.getByRole("button", { name: /save changes/i }));

  expect(screen.getByText("Artist is required")).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test("selecting an album saves that album id", async () => {
  const user = userEvent.setup();
  const onSave = renderTab();

  const album = screen.getByRole("textbox", { name: /^album$/i });
  await user.clear(album);
  await user.type(album, "Kind");
  await user.click(await screen.findByRole("button", { name: /Kind of Blue/ }));
  await user.click(screen.getByRole("button", { name: /save changes/i }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Coca-Cola Mentos",
      artistId: "artist-meryl",
      albumId: "album-blue",
    }),
  );
});

test("clearing the album saves a null album id", async () => {
  const user = userEvent.setup();
  const onSave = renderTab();

  await user.clear(screen.getByRole("textbox", { name: /^album$/i }));
  await user.click(screen.getByRole("button", { name: /save changes/i }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Coca-Cola Mentos",
      artistId: "artist-meryl",
      albumId: null,
    }),
  );
});

test("restores an album draft and saves that album id", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(
    <BasicMetadataTab
      track={track}
      onSave={onSave}
      initialDraft={{ albumId: "album-blue", albumName: "Kind of Blue" }}
    />,
  );

  expect(screen.getByRole("textbox", { name: /^album$/i })).toHaveValue("Kind of Blue");
  await user.click(screen.getByRole("button", { name: /save changes/i }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      albumId: "album-blue",
      title: "Coca-Cola Mentos",
      artistId: "artist-meryl",
    }),
  );
});

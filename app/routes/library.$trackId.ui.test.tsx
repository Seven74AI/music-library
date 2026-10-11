/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import TrackRoute, {
  chooseRelatedTracks,
  orderedGenreNames,
  playbackContextForTrack,
} from "./library.$trackId.tsx";

type MockUser = {
  id: string;
  roles: Array<{
    name: string;
    permissions: Array<{ action: string; entity: string; access: string }>;
  }>;
};

const userState = vi.hoisted(() => ({
  current: undefined as MockUser | null | undefined,
}));

const player = vi.hoisted(() => ({
  playTrack: vi.fn(),
  playNextTrack: vi.fn(),
  addToUpNext: vi.fn(),
  addToQueue: vi.fn(),
  isLoadingNext: false,
}));

const download = vi.hoisted(() => ({
  downloadAudioFile: vi.fn(),
  isDownloading: false,
  label: "Download",
}));

vi.mock("#app/utils/user.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/user.ts")>();
  return {
    ...actual,
    useOptionalUser: () => userState.current,
  };
});

vi.mock("#app/components/audio-player-provider.tsx", () => ({
  useAudioPlayer: () => player,
}));

vi.mock("#app/hooks/use-track-audio-file-download.ts", () => ({
  useTrackAudioFileDownload: () => download,
}));

vi.mock("#app/components/ui/use-toast.ts", () => ({
  toast: vi.fn(),
}));

vi.mock("#app/components/track-details-dialog.tsx", () => ({
  TrackDetailsDialog: ({ open, trackId }: { open: boolean; trackId: string }) =>
    open ? <div role="dialog">Edit {trackId}</div> : null,
}));

vi.mock("#app/components/track-list-item.tsx", () => ({
  TrackListItem: ({
    track,
    playlistContext,
  }: {
    track: { title: string };
    playlistContext?: { type: string };
  }) => (
    <div>
      <span>{track.title}</span>
      <span>{playlistContext?.type}</span>
    </div>
  ),
}));

beforeAll(() => {
  const proto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};

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

type LoaderData = {
  track: {
    id: string;
    title: string;
    artist: { id: string; name: string };
    albumRecord: { id: string; name: string } | null;
    duration: number | null;
    genre: string | null;
    genres: Array<{ id: string; name: string }>;
    year: number | null;
    trackNumber: number | null;
    totalTracks: number | null;
    albumArtist: string | null;
    bpm: number | null;
    label: string | null;
    isrc: string | null;
    releaseDate: string | null;
    lyrics: string | null;
    createdAt: string;
    updatedAt: string;
    coverImage: { objectKey: string } | null;
    serviceUrl: string | null;
    service: { displayName: string } | null;
    audioFiles: Array<{
      id: string;
      format: string | null;
      objectKey: string;
      fileSize: number | null;
      bitrate: number | null;
      sampleRate: number | null;
    }>;
  };
  isInUserLibrary: boolean;
  canDownload?: boolean;
  playlists: Array<{
    id: string;
    title: string;
    description: string | null;
    _count: { tracks: number };
  }>;
  containingPlaylists: Array<{ id: string; title: string }>;
  related: {
    source: "album" | "artist";
    id: string;
    name: string;
    tracks: Array<{
      id: string;
      title: string;
      artist: { id: string; name: string };
      duration: number | null;
      createdAt: string;
      serviceUrl: string | null;
      coverImage: { objectKey: string } | null;
      service: { displayName: string; logoUrl: string | null } | null;
      audioFiles: Array<{ id: string; format: string | null; objectKey: string }>;
      isInUserLibrary: boolean;
    }>;
  } | null;
};

function relatedTrack(id: string, title: string) {
  return {
    id,
    title,
    artist: { id: "artist-1", name: "M83" },
    duration: 180,
    createdAt: "2024-02-01T00:00:00.000Z",
    serviceUrl: null,
    coverImage: null,
    service: null,
    audioFiles: [{ id: `${id}-audio`, format: "mp3", objectKey: `${id}.mp3` }],
    isInUserLibrary: true,
  };
}

function makeData(overrides: Partial<LoaderData> = {}): LoaderData {
  const track = {
    id: "track-1",
    title: "Midnight City",
    artist: { id: "artist-1", name: "M83" },
    albumRecord: { id: "album-1", name: "Hurry Up, We're Dreaming" },
    duration: 245,
    genre: "Electronic",
    genres: [
      { id: "g2", name: "Synth-pop" },
      { id: "g1", name: "Electronic" },
    ],
    year: 2011,
    trackNumber: 3,
    totalTracks: 22,
    albumArtist: "Anthony Gonzalez",
    bpm: 128,
    label: "Naïve",
    isrc: "USAAA1234567",
    releaseDate: "2011-10-17T00:00:00.000Z",
    lyrics: "Waiting in the car\nThe city is my church",
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-03T00:00:00.000Z",
    coverImage: { objectKey: "covers/midnight.jpg" },
    serviceUrl: "https://youtube.com/watch?v=abc",
    service: { displayName: "YouTube" },
    audioFiles: [
      {
        id: "audio-mp3",
        format: "mp3",
        objectKey: "audio/midnight.mp3",
        fileSize: 5 * 1024 * 1024,
        bitrate: 320,
        sampleRate: 44100,
      },
      {
        id: "audio-flac",
        format: "flac",
        objectKey: "audio/midnight.flac",
        fileSize: 10 * 1024 * 1024,
        bitrate: 900,
        sampleRate: 44100,
      },
    ],
    ...overrides.track,
  };

  return {
    isInUserLibrary: false,
    playlists: [
      {
        id: "pl-1",
        title: "Night Drive",
        description: null,
        _count: { tracks: 12 },
      },
    ],
    containingPlaylists: [{ id: "pl-1", title: "Night Drive" }],
    related: {
      source: "album",
      id: "album-1",
      name: "Hurry Up, We're Dreaming",
      tracks: [relatedTrack("track-2", "Another Song")],
    },
    ...overrides,
    track,
  };
}

function userWith(role: string): MockUser {
  return {
    id: `${role}-1`,
    roles: [{ name: role, permissions: [] }],
  };
}

function renderTrack(data: LoaderData = makeData()) {
  const router = createMemoryRouter(
    [
      {
        path: "/library/:trackId",
        element: (
          <TrackRoute
            loaderData={data as never}
            params={{ trackId: data.track.id }}
            matches={[] as never}
          />
        ),
      },
      { path: "/artists/:artistId", element: <div>Artist page</div> },
      { path: "/albums/:albumId", element: <div>Album page</div> },
      { path: "/playlists/:playlistId", element: <div>Playlist page</div> },
      { path: "/resources/track-library", action: () => ({ status: "success" }) },
      { path: "/api/curator/notes", loader: () => ({ notes: [] }) },
    ],
    { initialEntries: [`/library/${data.track.id}`] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  userState.current = userWith("user");
  player.playTrack.mockReset();
  player.playNextTrack.mockReset();
  player.addToUpNext.mockReset();
  player.addToQueue.mockReset();
  player.isLoadingNext = false;
  download.downloadAudioFile.mockReset();
  download.isDownloading = false;
  download.label = "Download";
});

test("play on the track page stays on this track", () => {
  expect(playbackContextForTrack("track-1")).toEqual({ type: "track", trackId: "track-1" });
});

test("related tracks prefer the album and fall back to the artist", () => {
  expect(
    chooseRelatedTracks({
      album: { id: "album-1", name: "Album" },
      artist: { id: "artist-1", name: "Artist" },
      albumTracks: ["album-sibling"],
      artistTracks: ["artist-sibling"],
    }),
  ).toEqual({
    source: "album",
    id: "album-1",
    name: "Album",
    tracks: ["album-sibling"],
  });

  expect(
    chooseRelatedTracks({
      album: { id: "album-1", name: "Album" },
      artist: { id: "artist-1", name: "Artist" },
      albumTracks: [],
      artistTracks: ["artist-sibling"],
    }),
  ).toEqual({
    source: "artist",
    id: "artist-1",
    name: "Artist",
    tracks: ["artist-sibling"],
  });

  expect(
    chooseRelatedTracks({
      album: null,
      artist: { id: "artist-1", name: "Artist" },
      albumTracks: [],
      artistTracks: [],
    }),
  ).toBeNull();
});

test("primary genre leads the genre list", () => {
  expect(orderedGenreNames([{ name: "Synth-pop" }, { name: "Electronic" }], "Electronic")).toEqual([
    "Electronic",
    "Synth-pop",
  ]);

  expect(orderedGenreNames([], "Jazz")).toEqual(["Jazz"]);
});

test("shows the track as a playable music page", async () => {
  const user = userEvent.setup();
  renderTrack();

  expect(screen.getByRole("heading", { level: 1, name: "Midnight City" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Midnight City" })).toHaveAttribute(
    "src",
    "/resources/images/covers/midnight.jpg",
  );
  expect(screen.getByRole("link", { name: "M83" })).toHaveAttribute("href", "/artists/artist-1");
  expect(screen.getByRole("link", { name: "Hurry Up, We're Dreaming" })).toHaveAttribute(
    "href",
    "/albums/album-1",
  );
  expect(screen.getByText("4:05")).toBeInTheDocument();
  expect(screen.getByText("2011")).toBeInTheDocument();
  expect(screen.getByText("Electronic, Synth-pop")).toBeInTheDocument();
  expect(screen.getByText("FLAC")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Track Information" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Play" }));
  expect(player.playTrack).toHaveBeenCalledWith(
    expect.objectContaining({ id: "track-1", title: "Midnight City" }),
    { type: "track", trackId: "track-1" },
  );

  await user.click(screen.getByRole("button", { name: "Download" }));
  expect(download.downloadAudioFile).toHaveBeenCalledOnce();
});

test("lists other tracks by the artist when the track has no album", async () => {
  const user = userEvent.setup();
  renderTrack(
    makeData({
      track: {
        ...makeData().track,
        albumRecord: null,
      },
      related: {
        source: "artist",
        id: "artist-1",
        name: "M83",
        tracks: [relatedTrack("track-9", "Wait")],
      },
    }),
  );

  await user.click(screen.getByRole("button", { name: "Play" }));
  expect(player.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "track-1" }), {
    type: "track",
    trackId: "track-1",
  });
  expect(screen.getByRole("heading", { name: "More from M83" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
    "href",
    "/artists/artist-1",
  );
  expect(screen.getByText("Wait")).toBeInTheDocument();
});

test("explains when the track cannot be played or downloaded", async () => {
  const user = userEvent.setup();
  renderTrack(
    makeData({
      track: {
        ...makeData().track,
        audioFiles: [],
        serviceUrl: null,
        service: null,
      },
    }),
  );

  const play = screen.getByRole("button", { name: "Play" });
  expect(play).toBeDisabled();
  await user.click(play);
  expect(player.playTrack).not.toHaveBeenCalled();
  expect(screen.getByText("Audio is not available for this track yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Report issue" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Play next" })).not.toBeInTheDocument();
});

test("shows audio quality, details, lyrics, playlists, and album neighbors", async () => {
  const user = userEvent.setup();
  renderTrack();

  const flac = screen.getByText("FLAC · 900 kbps · 44.1 kHz · 10.0 MB").closest("li");
  const mp3 = screen.getByText("MP3 · 320 kbps · 44.1 kHz · 5.0 MB").closest("li");
  expect(flac).not.toBeNull();
  expect(mp3).not.toBeNull();
  expect(flac).toHaveTextContent("Playback");
  expect(mp3).not.toHaveTextContent("Playback");

  expect(screen.getByText("3 of 22")).toBeInTheDocument();
  expect(screen.getByText("Anthony Gonzalez")).toBeInTheDocument();
  expect(screen.getByText("128")).toBeInTheDocument();
  expect(screen.getByText("Naïve")).toBeInTheDocument();
  expect(screen.getByText("USAAA1234567")).toBeInTheDocument();
  expect(screen.getByText("Oct 17, 2011")).toBeInTheDocument();
  expect(screen.queryByText("Jan 2, 2024")).not.toBeInTheDocument();
  expect(screen.queryByText("Added")).not.toBeInTheDocument();
  expect(screen.getByText(/Waiting in the car/)).toBeInTheDocument();
  expect(screen.getByText(/The city is my church/)).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Night Drive" })).toHaveAttribute(
    "href",
    "/playlists/pl-1",
  );
  expect(
    screen.getByRole("heading", { name: "More from Hurry Up, We're Dreaming" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Another Song")).toBeInTheDocument();
  expect(screen.getByText("album")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/albums/album-1");
  expect(screen.queryByText("Midnight City", { selector: "span" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add to playlist" }));
  expect(await screen.findByRole("listitem", { name: /Night Drive/ })).toBeInTheDocument();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Open on YouTube" })).toHaveAttribute(
    "href",
    "https://youtube.com/watch?v=abc",
  );
  await user.click(screen.getByRole("menuitem", { name: "Play next" }));
  expect(player.playNextTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "track-1" }));
});

test("hides library actions when the track is already saved", () => {
  renderTrack(makeData({ isInUserLibrary: true }));

  expect(screen.queryByRole("button", { name: "Add to library" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove from library" })).not.toBeInTheDocument();
});

test("offers add to library when the track is not saved", () => {
  renderTrack(makeData({ isInUserLibrary: false, containingPlaylists: [], canDownload: false }));

  expect(screen.getByRole("button", { name: "Add to library" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "In your playlists" })).not.toBeInTheDocument();
});

test("shows curator tools on the track page", async () => {
  userState.current = userWith("curator");
  const user = userEvent.setup();
  renderTrack();

  expect(screen.getByRole("heading", { name: "Curator notes" })).toBeInTheDocument();
  expect(screen.getByLabelText("Add a note")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /edit track/i }));
  expect(screen.getByText("Edit track-1")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /flag for review/i }));
  expect(await screen.findByRole("heading", { name: "Flag for Review" })).toBeInTheDocument();
});

test("hides curator tools from listeners", () => {
  userState.current = userWith("user");
  renderTrack();

  expect(screen.queryByRole("button", { name: /edit track/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /flag for review/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Add a note")).not.toBeInTheDocument();
});

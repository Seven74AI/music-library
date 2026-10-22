/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import ArtistRoute from "./artists.$artistId.tsx";

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

vi.mock("#app/utils/user.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/user.ts")>();
  return {
    ...actual,
    useOptionalUser: () => userState.current,
  };
});

vi.mock("#app/components/artist-edit-dialog.tsx", () => ({
  ArtistEditDialog: () => null,
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

const loaderData = {
  artist: {
    id: "artist-1",
    name: "Flagged Artist",
    genre: "Jazz",
    bio: null,
    imageUrl: null as string | null,
    country: null,
    website: null,
    createdAt: new Date("2024-01-01"),
    albums: [],
    trackCount: 0,
  },
  initialTracks: [],
  pagination: { limit: 20, hasNext: false, nextCursor: null },
  playlists: [],
};

function userWith(role: string, canEdit: boolean): MockUser {
  return {
    id: `${role}-1`,
    roles: [
      {
        name: role,
        permissions: canEdit ? [{ action: "update", entity: "artist", access: "any" }] : [],
      },
    ],
  };
}

function renderArtist(data: typeof loaderData = loaderData) {
  const router = createMemoryRouter(
    [
      {
        path: "/artists/:artistId",
        element: (
          <ArtistRoute
            loaderData={data as never}
            params={{ artistId: "artist-1" }}
            matches={[] as never}
          />
        ),
      },
      {
        path: "/api/curator/notes",
        loader: () => ({ notes: [] }),
      },
    ],
    { initialEntries: ["/artists/artist-1"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  userState.current = undefined;
});

test("loads the artist photo through the image proxy", () => {
  renderArtist({
    ...loaderData,
    artist: {
      ...loaderData.artist,
      imageUrl: "images/artists/artist-1/photo.jpg",
    },
  });

  expect(screen.getByRole("img", { name: "Flagged Artist" })).toHaveAttribute(
    "src",
    "/resources/images?src=images%2Fartists%2Fartist-1%2Fphoto.jpg&w=384&h=384&fit=cover&format=webp",
  );
});

test("proxies an external artist image url", () => {
  renderArtist({
    ...loaderData,
    artist: {
      ...loaderData.artist,
      imageUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    },
  });

  expect(screen.getByRole("img", { name: "Flagged Artist" })).toHaveAttribute(
    "src",
    "/resources/images?src=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fabc%2Fhqdefault.jpg&w=384&h=384&fit=cover&format=webp",
  );
});

test("shows a placeholder when the artist has no photo", () => {
  renderArtist();

  expect(screen.queryByRole("img", { name: "Flagged Artist" })).not.toBeInTheDocument();
});

test("shows curator notes on the artist page", () => {
  userState.current = userWith("curator", true);
  renderArtist();

  expect(screen.getByRole("heading", { name: "Curator notes" })).toBeDefined();
  expect(screen.getByLabelText("Add a note")).toBeDefined();
});

test("hides curator notes from listeners", () => {
  userState.current = userWith("user", false);
  renderArtist();

  expect(screen.queryByLabelText("Add a note")).toBeNull();
});

test("shows Flag for review next to Edit Artist for curators", async () => {
  userState.current = userWith("curator", true);
  const user = userEvent.setup();
  renderArtist();

  expect(screen.getByRole("button", { name: /edit artist/i })).toBeDefined();
  await user.click(screen.getByRole("button", { name: /flag for review/i }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Flag for Review" })).toBeDefined();
  expect(within(dialog).getByText(/Flagged Artist/)).toBeDefined();
});

test("shows Flag for review for admins", () => {
  userState.current = userWith("admin", true);
  renderArtist();

  expect(screen.getByRole("button", { name: /edit artist/i })).toBeDefined();
  expect(screen.getByRole("button", { name: /flag for review/i })).toBeDefined();
});

test("hides Flag for review from listeners who can edit", () => {
  userState.current = userWith("user", true);
  renderArtist();

  expect(screen.getByRole("button", { name: /edit artist/i })).toBeDefined();
  expect(screen.queryByRole("button", { name: /flag for review/i })).toBeNull();
});

test("hides Flag for review from listeners", () => {
  userState.current = userWith("user", false);
  renderArtist();

  expect(screen.queryByRole("button", { name: /edit artist/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /flag for review/i })).toBeNull();
});

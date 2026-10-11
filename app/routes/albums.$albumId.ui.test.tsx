/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import AlbumRoute from "./albums.$albumId.tsx";

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

const dialogAlbum = vi.hoisted(() => ({
  current: null as { coverImageId?: string | null } | null,
}));

vi.mock("#app/utils/user.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/user.ts")>();
  return {
    ...actual,
    useOptionalUser: () => userState.current,
  };
});

vi.mock("#app/components/album-edit-dialog.tsx", () => ({
  AlbumEditDialog: (props: { album: { coverImageId?: string | null } }) => {
    dialogAlbum.current = props.album;
    return null;
  },
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
  album: {
    id: "album-1",
    name: "Flagged Album",
    year: 2020,
    createdAt: new Date("2024-01-01"),
    artist: { id: "artist-1", name: "Album Artist" },
    coverImageId: null as string | null,
    coverImage: null as { objectKey: string } | null,
    tracks: [],
  },
  playlists: [],
};

function userWith(role: string, canEdit: boolean): MockUser {
  return {
    id: `${role}-1`,
    roles: [
      {
        name: role,
        permissions: canEdit ? [{ action: "update", entity: "album", access: "any" }] : [],
      },
    ],
  };
}

function renderAlbum(data: typeof loaderData = loaderData) {
  const router = createMemoryRouter(
    [
      {
        path: "/albums/:albumId",
        element: (
          <AlbumRoute
            loaderData={data as never}
            params={{ albumId: "album-1" }}
            matches={[] as never}
          />
        ),
      },
      {
        path: "/api/curator/notes",
        loader: () => ({ notes: [] }),
      },
    ],
    { initialEntries: ["/albums/album-1"] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  userState.current = undefined;
  dialogAlbum.current = null;
});

test("passes the CoverImage id into the editor, not the object key", () => {
  userState.current = userWith("curator", true);
  renderAlbum({
    ...loaderData,
    album: {
      ...loaderData.album,
      coverImageId: "cover-real-id",
      coverImage: { objectKey: "images/albums/not-the-id.jpg" },
    },
  });

  expect(dialogAlbum.current?.coverImageId).toBe("cover-real-id");
});

test("loads the album cover through the image proxy", () => {
  renderAlbum({
    ...loaderData,
    album: {
      ...loaderData.album,
      coverImage: { objectKey: "images/albums/flagged.jpg" },
    },
  });

  expect(screen.getByRole("img", { name: "Flagged Album" })).toHaveAttribute(
    "src",
    "/resources/images?src=images%2Falbums%2Fflagged.jpg&w=384&h=384&fit=cover&format=webp",
  );
});

test("shows a placeholder when the album has no cover", () => {
  renderAlbum();

  expect(screen.queryByRole("img", { name: "Flagged Album" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Flagged Album" })).toBeInTheDocument();
});

test("shows curator notes on the album page", () => {
  userState.current = userWith("curator", true);
  renderAlbum();

  expect(screen.getByRole("heading", { name: "Curator notes" })).toBeDefined();
  expect(screen.getByLabelText("Add a note")).toBeDefined();
});

test("hides curator notes from listeners", () => {
  userState.current = userWith("user", false);
  renderAlbum();

  expect(screen.queryByLabelText("Add a note")).toBeNull();
});

test("shows Flag for review next to Edit Album for curators", async () => {
  userState.current = userWith("curator", true);
  const user = userEvent.setup();
  renderAlbum();

  expect(screen.getByRole("button", { name: /edit album/i })).toBeDefined();
  await user.click(screen.getByRole("button", { name: /flag for review/i }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Flag for Review" })).toBeDefined();
  expect(within(dialog).getByText(/Flagged Album/)).toBeDefined();
});

test("shows Flag for review for admins", () => {
  userState.current = userWith("admin", true);
  renderAlbum();

  expect(screen.getByRole("button", { name: /edit album/i })).toBeDefined();
  expect(screen.getByRole("button", { name: /flag for review/i })).toBeDefined();
});

test("hides Flag for review from listeners who can edit", () => {
  userState.current = userWith("user", true);
  renderAlbum();

  expect(screen.getByRole("button", { name: /edit album/i })).toBeDefined();
  expect(screen.queryByRole("button", { name: /flag for review/i })).toBeNull();
});

test("hides Flag for review from listeners", () => {
  userState.current = userWith("user", false);
  renderAlbum();

  expect(screen.queryByRole("button", { name: /edit album/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /flag for review/i })).toBeNull();
});

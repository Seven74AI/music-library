/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ArtistRoute from "./artists.$artistId.tsx";

const mockSubmit = vi.hoisted(() => vi.fn());

const currentUser = vi.hoisted(() => ({
  value: null as {
    id: string;
    roles: Array<{
      name: string;
      permissions: Array<{ action: string; entity: string; access: string }>;
    }>;
  } | null,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      load: vi.fn(),
      submit: mockSubmit,
    }),
  };
});

vi.mock("#app/utils/user.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/user.ts")>();
  return {
    ...actual,
    useOptionalUser: () => currentUser.value,
  };
});

vi.mock("#app/components/track-list-item.tsx", () => ({
  TrackListItem: () => null,
}));

const curator = {
  id: "user-curator",
  roles: [
    {
      name: "curator",
      permissions: [{ action: "update", entity: "artist", access: "any" }],
    },
  ],
};

const regularUser = {
  id: "user-regular",
  roles: [{ name: "user", permissions: [] }],
};

const loaderData = {
  artist: {
    id: "artist-1",
    name: "Combined Artist",
    genre: "Rock",
    bio: null,
    imageUrl: null,
    country: null,
    website: null,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    albums: [],
    trackCount: 2,
  },
  initialTracks: [
    {
      id: "track-1",
      title: "Main Song",
      duration: 180,
      createdAt: new Date("2020-01-02T00:00:00.000Z"),
      serviceUrl: null,
      albumRecord: { id: "album-1", name: "Debut" },
      coverImage: null,
      service: null,
      audioFiles: [],
      isInUserLibrary: false,
      userTrackCreatedAt: "2020-01-02T00:00:00.000Z",
    },
    {
      id: "track-2",
      title: "Featured Song",
      duration: 200,
      createdAt: new Date("2020-01-03T00:00:00.000Z"),
      serviceUrl: null,
      albumRecord: { id: "album-2", name: "Side Project" },
      coverImage: null,
      service: null,
      audioFiles: [],
      isInUserLibrary: false,
      userTrackCreatedAt: "2020-01-03T00:00:00.000Z",
    },
  ],
  pagination: { limit: 50, hasNext: false, nextCursor: null },
  playlists: [],
};

function renderArtist() {
  const router = createMemoryRouter(
    [
      {
        path: "/artists/:artistId",
        element: (
          <ArtistRoute
            loaderData={loaderData as never}
            params={{ artistId: "artist-1" }}
            matches={[] as never}
          />
        ),
      },
    ],
    { initialEntries: ["/artists/artist-1"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("artist split control", () => {
  beforeEach(() => {
    currentUser.value = null;
    mockSubmit.mockReset();
  });

  test("shows Split Artist for a curator and submits the split API shape", async () => {
    currentUser.value = curator;
    const user = userEvent.setup();
    renderArtist();

    await user.click(screen.getByRole("button", { name: "Split Artist" }));
    expect(screen.getByRole("heading", { name: "Split Artist" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select All" }));
    expect(
      screen.getByText(/at least one track must remain with the original artist/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Split Artist" }).at(-1)).toBeDisabled();

    await user.click(screen.getByText("Main Song"));
    await user.type(screen.getByLabelText(/new artist name/i), "Featured Act");
    expect(screen.getAllByRole("button", { name: "Split Artist" }).at(-1)).toBeDisabled();

    await user.type(screen.getByLabelText(/split reason/i), "Separating featuring artist");
    await user.click(screen.getByLabelText(/i understand this will create a new artist/i));
    await user.click(screen.getAllByRole("button", { name: "Split Artist" }).at(-1)!);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(
      {
        trackIds: ["track-2"],
        newArtistName: "Featured Act",
        comment: "Separating featuring artist",
      },
      {
        method: "POST",
        action: "/api/metadata/artists/artist-1/split",
        encType: "application/json",
      },
    );
  });

  test("hides Split Artist for a regular user", () => {
    currentUser.value = regularUser;
    renderArtist();

    expect(screen.queryByRole("button", { name: "Split Artist" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Combined Artist" })).toBeInTheDocument();
  });

  test("hides Split Artist when nobody is signed in", () => {
    currentUser.value = null;
    renderArtist();

    expect(screen.queryByRole("button", { name: "Split Artist" })).not.toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { AlbumEditDialog, type Album } from "./album-edit-dialog";

const album: Album = {
  id: "album-1",
  name: "Abbey Road",
  artistId: "artist-1",
  year: 1969,
  coverImageId: null,
  coverImage: null,
  artist: { id: "artist-1", name: "The Beatles" },
};

const albumWithCover: Album = {
  ...album,
  coverImageId: "cover-old",
  coverImage: { objectKey: "images/albums/old.jpg" },
};

type Submission = {
  contentType: string | null;
  body: unknown;
};

async function readSubmission(request: Request): Promise<Submission> {
  const contentType = request.headers.get("content-type");
  const raw = await request.text();
  try {
    return { contentType, body: JSON.parse(raw) as unknown };
  } catch {
    return { contentType, body: raw };
  }
}

function renderDialog(current: Album) {
  let submission: Submission | null = null;

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AlbumEditDialog album={current} open onOpenChange={() => {}} />,
      },
      {
        path: "/api/artists/search",
        loader: () => ({
          artists: [{ id: "artist-2", name: "Audit Split Artist", trackCount: 1 }],
        }),
      },
      {
        path: "/api/images/from-url",
        action: async () => ({
          success: true,
          image: {
            id: "cover-from-url",
            objectKey: "images/albums/album-1/from-url.jpg",
            width: 600,
            height: 600,
            isPrimary: false,
          },
        }),
      },
      {
        path: "/api/images/upload",
        action: async () => ({
          success: true,
          image: {
            id: "cover-new",
            objectKey: "images/albums/album-1/new.png",
            width: 800,
            height: 800,
            isPrimary: false,
          },
        }),
      },
      {
        path: "/api/metadata/albums/:id/edit",
        action: async ({ request }) => {
          submission = await readSubmission(request);
          return { album: { id: current.id }, edit: { id: "edit-1" } };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  return {
    getSubmission: () => submission,
  };
}

test("cover upload enables save and submits the new CoverImage id", async () => {
  const user = userEvent.setup();
  const { getSubmission } = renderDialog(album);

  expect(screen.getByRole("button", { name: "Save Changes" }).hasAttribute("disabled")).toBe(true);

  await user.click(screen.getByRole("tab", { name: "Cover Art" }));
  const file = new File([new Uint8Array([137, 80, 78, 71])], "cover.png", {
    type: "image/png",
  });
  await user.upload(screen.getByLabelText(/choose image file/i), file);
  await user.click(screen.getByRole("tab", { name: "Metadata" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Save Changes" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(getSubmission()).not.toBeNull();
  });

  expect(getSubmission()!.contentType).toContain("application/json");
  expect(getSubmission()!.body).toEqual({
    name: "Abbey Road",
    artistId: "artist-1",
    year: 1969,
    coverImageId: "cover-new",
    comment: "",
  });
});

test("a name change keeps the existing CoverImage id instead of the object key", async () => {
  const user = userEvent.setup();
  const { getSubmission } = renderDialog(albumWithCover);

  const name = screen.getByLabelText(/name/i);
  await user.clear(name);
  await user.type(name, "Abbey Road (Remastered)");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(getSubmission()).not.toBeNull();
  });

  expect(getSubmission()!.body).toEqual({
    name: "Abbey Road (Remastered)",
    artistId: "artist-1",
    year: 1969,
    coverImageId: "cover-old",
    comment: "",
  });
});

test("saves a different artist chosen from the artist field", async () => {
  const user = userEvent.setup();
  const { getSubmission } = renderDialog(album);

  const artistInput = screen.getByLabelText(/^Artist/);
  await user.clear(artistInput);
  await user.type(artistInput, "Audit");
  await user.click(await screen.findByRole("button", { name: /Audit Split Artist/ }));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(getSubmission()).not.toBeNull();
  });

  expect(getSubmission()!.body).toEqual({
    name: "Abbey Road",
    artistId: "artist-2",
    year: 1969,
    coverImageId: null,
    comment: "",
  });
});

test("a cover from URL is saved as the CoverImage id", async () => {
  const user = userEvent.setup();
  const { getSubmission } = renderDialog(album);

  await user.click(screen.getByRole("tab", { name: "Cover Art" }));
  await user.click(screen.getByRole("button", { name: "From URL" }));
  await user.type(screen.getByLabelText(/image url/i), "https://example.com/cover.jpg");
  await user.click(screen.getByRole("button", { name: "Upload" }));
  await user.click(screen.getByRole("tab", { name: "Metadata" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Save Changes" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(getSubmission()).not.toBeNull();
  });

  expect(getSubmission()!.body).toEqual({
    name: "Abbey Road",
    artistId: "artist-1",
    year: 1969,
    coverImageId: "cover-from-url",
    comment: "",
  });
});

test("resets the form when a different album is passed to the open dialog", async () => {
  const user = userEvent.setup();
  const albumB: Album = {
    id: "album-2",
    name: "Revolver",
    artistId: "artist-2",
    year: 1966,
    coverImageId: "cover-b",
    coverImage: { objectKey: "images/albums/revolver.jpg" },
    artist: { id: "artist-2", name: "The Beatles Later" },
  };
  let setAlbum = (_album: Album) => {};
  let actionUrl = "";
  let submission: Submission | null = null;

  function Harness() {
    const [current, setCurrent] = useState(album);
    setAlbum = setCurrent;
    return <AlbumEditDialog album={current} open onOpenChange={() => {}} />;
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/artists/search",
        loader: () => ({ artists: [] }),
      },
      {
        path: "/api/metadata/albums/:id/edit",
        action: async ({ request }) => {
          actionUrl = new URL(request.url).pathname;
          submission = await readSubmission(request);
          return { album: { id: "album-2" }, edit: { id: "edit-2" } };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  expect(screen.getByLabelText(/name/i)).toHaveValue("Abbey Road");
  expect(screen.getByLabelText(/^Artist/)).toHaveValue("The Beatles");

  await act(async () => {
    setAlbum(albumB);
  });

  expect(screen.getByLabelText(/name/i)).toHaveValue("Revolver");
  expect(screen.queryByDisplayValue("Abbey Road")).toBeNull();
  expect(screen.getByLabelText(/^Artist/)).toHaveValue("The Beatles Later");
  expect((screen.getByLabelText(/^Year/) as HTMLInputElement).value).toBe("1966");
  expect(screen.getByRole("button", { name: "Save Changes" }).hasAttribute("disabled")).toBe(true);

  await user.click(screen.getByRole("tab", { name: "Cover Art" }));
  expect(screen.getByText("Current image")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Current image" }).getAttribute("src")).toContain(
    "revolver.jpg",
  );

  await user.click(screen.getByRole("tab", { name: "Metadata" }));
  const name = screen.getByLabelText(/name/i);
  await user.clear(name);
  await user.type(name, "Revolver Remastered");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(submission).not.toBeNull();
  });

  expect(actionUrl).toContain("/albums/album-2/edit");
  expect(submission!.body).toEqual({
    name: "Revolver Remastered",
    artistId: "artist-2",
    year: 1966,
    coverImageId: "cover-b",
    comment: "",
  });
});

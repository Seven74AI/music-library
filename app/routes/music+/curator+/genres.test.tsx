/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { expect, test } from "vitest";
import GenresPage from "./genres.tsx";

const genres = [
  {
    id: "genre-jazz",
    name: "Jazz",
    trackCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "genre-rock",
    name: "Rock",
    trackCount: 1,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

function renderGenres(actions?: { create?: () => unknown; update?: () => unknown }) {
  const App = createRoutesStub([
    {
      path: "/music/curator/genres",
      Component: GenresPage,
      loader: () => ({ genres }),
      HydrateFallback: () => <div>Loading...</div>,
    },
    {
      path: "/api/genres",
      action: () => actions?.create?.() ?? { error: "Genre already exists" },
    },
    {
      path: "/api/genres/:id",
      action: () => actions?.update?.() ?? { error: "A genre with this name already exists" },
    },
  ]);

  render(<App initialEntries={["/music/curator/genres"]} />);
}

test("genre name links to the library filtered by that genre", async () => {
  renderGenres();

  const link = await screen.findByRole("link", { name: "Jazz" });
  expect(link).toHaveAttribute("href", "/library?genre=genre-jazz");
  expect(screen.queryByRole("button", { name: "Jazz" })).not.toBeInTheDocument();
});

test("creating a duplicate genre shows the 409 message on the form", async () => {
  const user = userEvent.setup();
  renderGenres();

  await user.click(await screen.findByRole("button", { name: "Add Genre" }));
  await user.type(screen.getByLabelText("Genre Name"), "Jazz");
  await user.click(screen.getByRole("button", { name: "Create" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Genre already exists");
  // The dialog marks the page inert, so the heading is present but not exposed.
  expect(
    screen.getByRole("heading", { name: "Genre Management", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Create New Genre" })).toBeInTheDocument();
  expect(screen.queryByText(/^409/)).not.toBeInTheDocument();
});

test("a unique genre create closes the dialog and stays on the page", async () => {
  const user = userEvent.setup();
  renderGenres({
    create: () => ({
      genre: {
        id: "genre-house",
        name: "House",
        trackCount: 0,
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    }),
  });

  await user.click(await screen.findByRole("button", { name: "Add Genre" }));
  await user.type(screen.getByLabelText("Genre Name"), "House");
  await user.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Create New Genre" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("heading", { name: "Genre Management" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("renaming a genre to an existing name shows the 409 message on the form", async () => {
  const user = userEvent.setup();
  renderGenres();

  await user.click(await screen.findByRole("button", { name: "Edit Rock" }));
  const name = screen.getByLabelText("Genre Name");
  await user.clear(name);
  await user.type(name, "Jazz");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A genre with this name already exists",
  );
  // The dialog marks the page inert, so the heading is present but not exposed.
  expect(
    screen.getByRole("heading", { name: "Genre Management", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Edit Genre" })).toBeInTheDocument();
  expect(screen.queryByText(/^409/)).not.toBeInTheDocument();
});

test("a unique rename closes the dialog and stays on the page", async () => {
  const user = userEvent.setup();
  renderGenres({
    update: () => ({
      genre: {
        id: "genre-rock",
        name: "Rock & Roll",
        trackCount: 1,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    }),
  });

  await user.click(await screen.findByRole("button", { name: "Edit Rock" }));
  const name = screen.getByLabelText("Genre Name");
  await user.clear(name);
  await user.type(name, "Rock & Roll");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Edit Genre" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("heading", { name: "Genre Management" })).toBeInTheDocument();
});

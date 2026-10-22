/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { AlbumCard } from "./album-card.tsx";

function renderCard(coverObjectKey?: string | null) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AlbumCard
            id="album-1"
            name="Jour avant caviar"
            year={2020}
            trackCount={2}
            coverObjectKey={coverObjectKey}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

test("requests a proxied square cover", () => {
  renderCard("images/albums/jour.jpg");

  expect(screen.getByRole("img", { name: "Jour avant caviar" })).toHaveAttribute(
    "src",
    "/resources/images?src=images%2Falbums%2Fjour.jpg&w=512&h=512&fit=cover&format=webp",
  );
});

test("shows a placeholder when the album has no cover", () => {
  renderCard(null);

  expect(screen.queryByRole("img", { name: "Jour avant caviar" })).not.toBeInTheDocument();
  expect(screen.getByText("Jour avant caviar")).toBeInTheDocument();
});

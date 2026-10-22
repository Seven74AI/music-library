/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { MarketingHome } from "./marketing-home.tsx";

function renderMarketing() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <MarketingHome />,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("shows 7D Music brand title", () => {
  renderMarketing();

  expect(screen.getByText("7D")).toBeInTheDocument();
  expect(screen.getByText("Music")).toBeInTheDocument();
  expect(screen.queryByText("epic")).not.toBeInTheDocument();
});

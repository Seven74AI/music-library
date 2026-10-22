/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, data, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { consoleError, consoleWarn } from "#tests/setup/setup-test-env.ts";
import { RootErrorBoundary } from "./root-error-boundary.tsx";

function renderBoundary(loader: () => unknown) {
  consoleError.mockImplementation(() => {});
  consoleWarn.mockImplementation(() => {});

  const router = createMemoryRouter(
    [
      {
        path: "/",
        loader,
        Component: () => <div>Loaded</div>,
        ErrorBoundary: RootErrorBoundary,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("an admin role 403 says you must be an admin", async () => {
  renderBoundary(() => {
    throw data(
      {
        error: "Unauthorized",
        requiredRole: "admin",
        message: "Unauthorized: required role: admin",
      },
      { status: 403 },
    );
  });

  expect(await screen.findByText(/you must be an admin/i)).toBeInTheDocument();
});

test("other 403s keep the status text", async () => {
  renderBoundary(() => {
    throw data({ error: "Unauthorized", message: "nope" }, { status: 403 });
  });

  expect(await screen.findByText(/403/)).toBeInTheDocument();
  expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
  expect(screen.queryByText(/you must be an admin/i)).not.toBeInTheDocument();
});

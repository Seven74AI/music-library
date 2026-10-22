/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, data, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { consoleError, consoleWarn } from "#tests/setup/setup-test-env.ts";
import { GeneralErrorBoundary } from "./error-boundary";

function renderBoundary(loader: () => unknown) {
  consoleError.mockImplementation(() => {});
  consoleWarn.mockImplementation(() => {});

  const router = createMemoryRouter(
    [
      {
        path: "/",
        loader,
        Component: () => <div>Loaded</div>,
        ErrorBoundary: GeneralErrorBoundary,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

test("renders an object data payload without crashing", async () => {
  renderBoundary(() => {
    throw data({ error: "Invalid JSON body" }, { status: 400 });
  });

  expect(await screen.findByText(/400/)).toBeTruthy();
  expect(screen.getByText(/Invalid JSON body/)).toBeTruthy();
  expect(screen.queryByText(/Application Error/i)).toBeNull();
});

test("renders object data that has no error string without crashing", async () => {
  renderBoundary(() => {
    throw data({ details: { title: ["Title is required"] } }, { status: 400 });
  });

  const message = await screen.findByText(/400/);
  expect(message.textContent).toContain("Title is required");
  expect(screen.queryByText(/Application Error/i)).toBeNull();
});

test("still renders string error data", async () => {
  renderBoundary(() => {
    throw new Response("Not found", { status: 404 });
  });

  expect(await screen.findByText(/404/)).toBeTruthy();
  expect(screen.getByText(/Not found/)).toBeTruthy();
});

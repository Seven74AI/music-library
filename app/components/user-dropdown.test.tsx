/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { UserDropdown } from "./user-dropdown.tsx";

vi.mock("#app/utils/user.ts", () => ({
  useUser: () => ({
    id: "user-1",
    name: "Kody",
    username: "kody",
    image: null,
    roles: [{ name: "user", permissions: [] }],
  }),
  userHasRole: () => false,
}));

function renderDropdown() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <UserDropdown />,
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("includes Party Room link for all viewports", async () => {
  const user = userEvent.setup();
  renderDropdown();

  await user.click(screen.getByRole("button", { name: /user menu/i }));

  const rooms = await screen.findByRole("menuitem", { name: /party room/i });
  expect(rooms.className).not.toMatch(/\bmax-md:hidden\b/);
  expect(rooms).toHaveAttribute("href", "/rooms");
});

test("keeps the user menu inside the viewport", async () => {
  const user = userEvent.setup();
  renderDropdown();

  await user.click(screen.getByRole("button", { name: /user menu/i }));

  const menu = await screen.findByRole("menu");
  expect(menu.className).toContain("max-w-[calc(100%-1rem)]");
});

test("includes My reports for every signed-in user", async () => {
  const user = userEvent.setup();
  renderDropdown();

  await user.click(screen.getByRole("button", { name: /user menu/i }));

  const reports = await screen.findByRole("menuitem", { name: /my reports/i });
  expect(reports).toHaveAttribute("href", "/reports");
  expect(reports.className).not.toMatch(/\bmax-md:hidden\b/);
});

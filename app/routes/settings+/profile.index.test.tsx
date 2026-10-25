/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import ProfileIndexRoute from "./profile.index.tsx";

vi.mock("openimg/react", () => ({
  Img: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
}));

const loaderData = {
  user: {
    id: "user-1",
    name: "QA-settings Renamed",
    username: "qasetbn693z350",
    email: "qa@example.com",
    image: null,
    _count: { sessions: 1 },
  },
  hasPassword: true,
  isTwoFactorEnabled: false,
};

function renderProfile() {
  const router = createMemoryRouter(
    [
      {
        path: "/settings/profile",
        element: (
          <ProfileIndexRoute loaderData={loaderData as never} params={{}} matches={[] as never} />
        ),
      },
    ],
    { initialEntries: ["/settings/profile"] },
  );
  return render(<RouterProvider router={router} />);
}

test("stacks username and name on small screens and uses two columns from md", async () => {
  renderProfile();

  const username = await screen.findByRole("textbox", { name: /^username$/i });
  const name = screen.getByRole("textbox", { name: /^name$/i });
  expect(username).toHaveValue("qasetbn693z350");
  expect(name).toHaveValue("QA-settings Renamed");

  const usernameField = username.parentElement;
  const nameField = name.parentElement;
  const grid = usernameField?.parentElement;
  expect(grid).toBeTruthy();
  expect(grid).toBe(nameField?.parentElement);
  expect(grid).toHaveClass("grid", "grid-cols-1", "gap-x-10", "md:grid-cols-2");
  expect(grid).not.toHaveClass("grid-cols-6");
  expect(usernameField).not.toHaveClass("col-span-3");
  expect(nameField).not.toHaveClass("col-span-3");

  const save = screen.getByRole("button", { name: /save changes/i });
  expect(save).toHaveAttribute("type", "submit");
  expect(save).toHaveAttribute("name", "intent");
  expect(save).toHaveAttribute("value", "update-profile");
});

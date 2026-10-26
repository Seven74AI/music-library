/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { roomChromeScrollClearance } from "#app/components/pwa/install-app-banner.tsx";
import { SiteFooter } from "#app/root.tsx";

test("footer links to About, Privacy, and Terms and clears the install banner", () => {
  const router = createMemoryRouter([{ path: "/", element: <SiteFooter /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);

  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toContain(roomChromeScrollClearance);
  expect(footer.className).toContain("--install-banner-height");

  expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/tos");
  expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} Music Library`);
});

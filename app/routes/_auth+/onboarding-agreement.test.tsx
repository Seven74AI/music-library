/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { OnboardingAgreementLabel } from "./onboarding-agreement.tsx";

test("onboarding agreement links the terms and privacy policy", () => {
  const router = createMemoryRouter([{ path: "/", element: <OnboardingAgreementLabel /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);

  expect(screen.getByText(/do you agree to our/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/tos");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

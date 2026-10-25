/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import SupportRoute from "./support.tsx";

test("public support page is useful without promising a reply or admin cookie steps", () => {
  render(<SupportRoute />);

  expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeInTheDocument();
  expect(screen.getByText(/handled by the library operator/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Connecting YouTube" })).toBeInTheDocument();
  expect(
    screen.getByText(/connect your YouTube account from the services page/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Offline playback" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Account & data" })).toBeInTheDocument();
  expect(screen.getByText(/sign up, then sign in/i)).toBeInTheDocument();

  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/get back to you/i);
  expect(text).not.toMatch(/we'll|we will/i);
  expect(text).not.toMatch(/cookie/i);
  expect(text).not.toMatch(/admin audio queue/i);
  expect(text).not.toMatch(/@/);
});

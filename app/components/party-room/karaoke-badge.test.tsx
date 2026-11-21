/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { KaraokeBadge } from "./karaoke-badge.tsx";

test("renders the Karaoke pill", () => {
  render(<KaraokeBadge />);
  expect(screen.getByTestId("karaoke-badge").textContent).toBe("Karaoke");
});

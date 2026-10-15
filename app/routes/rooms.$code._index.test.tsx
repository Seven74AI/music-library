/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test } from "vitest";
import {
  GUEST_DISPLAY_NAME_MAX,
  GUEST_DISPLAY_NAME_MIN,
} from "#app/features/party-room/constants.ts";
import GuestJoinOrRoom from "./rooms.$code._index.tsx";

describe("guest join form", () => {
  test("shows the 1–24 character display name limit", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/rooms/:code",
          HydrateFallback: () => null,
          Component: GuestJoinOrRoom,
          loader: () => ({ code: "AB3K9Q", seated: false, participant: null }),
        },
      ],
      { initialEntries: ["/rooms/AB3K9Q"] },
    );
    render(<RouterProvider router={router} />);

    const hint = `${GUEST_DISPLAY_NAME_MIN}–${GUEST_DISPLAY_NAME_MAX} characters`;
    expect(await screen.findByText(hint)).toBeInTheDocument();
    const field = screen.getByLabelText(/display name/i);
    expect(field).toHaveAttribute("minLength", String(GUEST_DISPLAY_NAME_MIN));
    expect(field).toHaveAttribute("maxLength", String(GUEST_DISPLAY_NAME_MAX));
  });
});

/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PlaylistCover } from "./playlist-cover.tsx";

test("requests proxy dimensions matching the cover size variant", () => {
  render(
    <PlaylistCover
      size="lg"
      tracks={[
        {
          id: "track-1",
          coverImage: { objectKey: "images/tracks/track-1/cover.jpg" },
        },
      ]}
    />,
  );

  const image = screen.getByRole("img", { name: "Playlist cover" });
  expect(image.getAttribute("src")).toContain("w=256");
  expect(image.getAttribute("src")).toContain("h=256");
});

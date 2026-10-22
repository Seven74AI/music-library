/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PasteMetadataDialog } from "./metadata-clipboard.tsx";
import { type MetadataClipboard } from "#app/features/curator/metadata-clipboard.ts";

const clipboard: MetadataClipboard = {
  artistId: "artist-1",
  artistName: "Miles Davis",
  albumId: "album-1",
  albumName: "Kind of Blue",
  genre: "Jazz",
  genreIds: ["genre-jazz"],
  year: 1959,
  albumArtist: "Miles Davis",
  bpm: 108,
  label: "Columbia",
};

test("apply reports only the fields that stay checked", async () => {
  const user = userEvent.setup();
  const onApply = vi.fn();
  render(
    <PasteMetadataDialog
      open
      onOpenChange={() => {}}
      trackId="track-1"
      clipboard={clipboard}
      onApply={onApply}
    />,
  );

  await user.click(screen.getByLabelText(/Year/));
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledOnce();
  const fields = onApply.mock.calls[0]?.[0] as string[];
  expect(fields).not.toContain("year");
  expect(fields).toEqual(
    expect.arrayContaining(["artist", "album", "genre", "albumArtist", "bpm", "label"]),
  );
});

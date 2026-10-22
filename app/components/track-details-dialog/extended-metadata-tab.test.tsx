/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { type TrackDetails } from "../track-details-dialog";
import { ExtendedMetadataTab, toDateInputValue } from "./extended-metadata-tab";

const track: TrackDetails = {
  id: "track-tcq",
  title: "TCQDOF",
  artist: { id: "artist-1", name: "Artist" },
  albumRecord: null,
  duration: 180,
  createdAt: "2023-01-01T00:00:00.000Z",
  releaseDate: null,
  originalDate: null,
  coverImage: null,
  service: null,
  serviceUrl: null,
  genre: null,
  genres: [],
  year: 1998,
  trackNumber: 7,
  albumArtist: "Extended Album Artist",
  bpm: 120,
  label: "Extended Label",
  isrc: "USRC17607839",
  originalYear: 2016,
  totalTracks: 14,
  totalDiscs: 2,
  lyrics: "Line one of the editor check\nLine two stays",
};

test("toDateInputValue reads UTC calendar days from Date and ISO strings", () => {
  expect(toDateInputValue(new Date("2018-04-21T00:00:00.000Z"))).toBe("2018-04-21");
  expect(toDateInputValue("2016-11-02T00:00:00.000Z")).toBe("2016-11-02");
  expect(toDateInputValue(null)).toBe("");
});

test("renders revived Date fields in the date inputs", () => {
  render(
    <ExtendedMetadataTab
      track={{
        ...track,
        releaseDate: new Date("2018-04-21T00:00:00.000Z"),
        originalDate: new Date("2016-11-02T00:00:00.000Z"),
      }}
      onSave={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("Release Date")).toHaveValue("2018-04-21");
  expect(screen.getByLabelText("Original Date")).toHaveValue("2016-11-02");
  expect(screen.getByLabelText("Label")).toHaveValue("Extended Label");
  expect(screen.getByLabelText("Lyrics")).toHaveValue(
    "Line one of the editor check\nLine two stays",
  );
});

test("disables extended fields while another curator holds the lock", () => {
  render(<ExtendedMetadataTab track={track} onSave={vi.fn()} disabled />);

  expect(screen.getByLabelText("Label")).toBeDisabled();
  expect(screen.getByLabelText("Lyrics")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
});

import { expect, test } from "vitest";
import {
  QUEUE_STATUS_MINE,
  entityPath,
  entityTypeLabel,
  filedReportMessage,
  queueActionFeedback,
  queueMatter,
  queueStatusLabel,
  resolutionLabel,
} from "./review-queue.ts";

test("matter is the report description", () => {
  expect(
    queueMatter({ issueType: "wrong_metadata", description: "  Artist is Miles, not Bill  " }),
  ).toBe("Artist is Miles, not Bill");
});

test("matter explains the issue type when the report has no description", () => {
  expect(queueMatter({ issueType: "missing_info", description: "   " })).toBe(
    "No extra detail was given. The report is marked as Missing info.",
  );
});

test("matter keeps an unknown issue type readable", () => {
  expect(queueMatter({ issueType: "import_error", description: null })).toBe(
    "No extra detail was given. The report is marked as import_error.",
  );
});

test("entity path uses the library, artist, or album page", () => {
  expect(entityPath("track", "track-1")).toBe("/library/track-1");
  expect(entityPath("artist", "artist-1")).toBe("/artists/artist-1");
  expect(entityPath("album", "album-1")).toBe("/albums/album-1");
  expect(entityPath("playlist", "playlist-1")).toBeNull();
});

test("entity type label is a name, not a raw id", () => {
  expect(entityTypeLabel("track")).toBe("Track");
  expect(entityTypeLabel("artist")).toBe("Artist");
  expect(entityTypeLabel("album")).toBe("Album");
  expect(QUEUE_STATUS_MINE).toBe("mine");
});

test("status and resolution labels are words", () => {
  expect(queueStatusLabel("claimed")).toBe("Claimed");
  expect(resolutionLabel("not_an_issue")).toBe("Not an issue");
});

test("a filed report tells the listener where to find it", () => {
  expect(filedReportMessage("So What — Miles Davis", "The artist credit is wrong")).toBe(
    "So What — Miles Davis. Matter: The artist credit is wrong. Find it under My reports.",
  );
  expect(filedReportMessage("So What — Miles Davis", "Audio cuts out.")).toBe(
    "So What — Miles Davis. Matter: Audio cuts out. Find it under My reports.",
  );
});

const sampleItem = {
  issueType: "wrong_metadata",
  description: "The artist credit is wrong",
  entityDetails: { name: "So What — Miles Davis" },
};

test("claim, unclaim, and resolve say where the report went", () => {
  expect(queueActionFeedback({ kind: "claim", item: sampleItem })).toEqual({
    status: "mine",
    title: "Claim saved",
    description:
      "So What — Miles Davis. Matter: The artist credit is wrong. Find it under My claims.",
  });
  expect(queueActionFeedback({ kind: "unclaim", item: sampleItem })).toEqual({
    status: "open",
    title: "Claim released",
    description:
      "So What — Miles Davis. Matter: The artist credit is wrong. It's back in the open list.",
  });
  expect(
    queueActionFeedback({
      kind: "resolve",
      item: sampleItem,
      resolution: "fixed",
      resolutionComment: "Updated the artist credit",
    }),
  ).toEqual({
    status: "resolved",
    title: "Resolution saved",
    description: "So What — Miles Davis. Fixed: Updated the artist credit. Find it under Resolved.",
  });
});

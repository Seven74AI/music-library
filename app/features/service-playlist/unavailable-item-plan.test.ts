import { describe, expect, test } from "vitest";
import { planUnavailableItemProcessing } from "./unavailable-item-plan.server";

const existingTrack = {
  id: "track-1",
  title: "Real Title",
  artistId: "artist-1",
  coverImageId: null as string | null,
  externalId: "video-1" as string | null,
};

describe("planUnavailableItemProcessing", () => {
  test("unavailable with existing match processes that track", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: true,
        itemId: "item-1",
        videoId: "",
        playlistId: "pl-1",
        position: 3,
        existingTrack,
      }),
    ).toEqual({
      kind: "process",
      externalId: "item-1",
      existingTrack,
    });
  });

  test("unavailable with videoId match uses videoId as externalId", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: true,
        itemId: undefined,
        videoId: "video-abc",
        playlistId: "pl-1",
        position: 1,
        existingTrack: { ...existingTrack, externalId: "video-abc" },
      }),
    ).toEqual({
      kind: "process",
      externalId: "video-abc",
      existingTrack: { ...existingTrack, externalId: "video-abc" },
    });
  });

  test("unavailable without match defers with item id as pending externalId", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: true,
        itemId: "item-orphan",
        videoId: "",
        playlistId: "pl-1",
        position: 2,
        existingTrack: null,
      }),
    ).toEqual({
      kind: "defer",
      externalId: "item-orphan",
    });
  });

  test("unavailable without match or item id uses pending playlist position id", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: true,
        itemId: undefined,
        videoId: "",
        playlistId: "pl-1",
        position: 7,
        existingTrack: null,
      }),
    ).toEqual({
      kind: "defer",
      externalId: "pending-pl-1-7",
    });
  });

  test("available with videoId processes normally", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: false,
        itemId: "item-1",
        videoId: "video-ok",
        playlistId: "pl-1",
        position: 1,
        existingTrack: null,
      }),
    ).toEqual({
      kind: "process",
      externalId: "video-ok",
      existingTrack: null,
    });
  });

  test("available with empty videoId is skipped", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: false,
        itemId: "item-1",
        videoId: "",
        playlistId: "pl-1",
        position: 1,
        existingTrack: null,
      }),
    ).toEqual({
      kind: "skip",
      reason: "missing externalId",
    });
  });

  test("unavailable with match but empty ids synthesizes deleted externalId", () => {
    expect(
      planUnavailableItemProcessing({
        isUnavailable: true,
        itemId: undefined,
        videoId: "",
        playlistId: "pl-1",
        position: 4,
        existingTrack,
      }),
    ).toEqual({
      kind: "process",
      externalId: "deleted-pl-1-4",
      existingTrack,
    });
  });
});

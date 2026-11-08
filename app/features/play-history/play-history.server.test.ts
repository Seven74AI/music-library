import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser, createTrack, resetUsageAnalyticsTables } from "#tests/db-utils.ts";
import {
  getPlayHistory,
  parseHistoryCursor,
  serializeHistoryCursor,
} from "./play-history.server.ts";

describe("parseHistoryCursor", () => {
  test("rejects malformed cursors", () => {
    expect(() => parseHistoryCursor("not-valid")).toThrow(/Invalid cursor format/);
  });
});

describe("getPlayHistory cursor fail-closed", () => {
  beforeEach(async () => {
    await resetUsageAnalyticsTables();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("rejects cursor when play_started row is missing for user", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const other = await prisma.user.create({ data: createUser() });
    const track = await createTrack("Song");

    const event = await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: other.id,
        trackId: track.id,
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
      },
    });

    const cursor = parseHistoryCursor(
      serializeHistoryCursor({ createdAt: event.createdAt, id: event.id }),
    );

    await expect(getPlayHistory({ userId: user.id, cursor, limit: 10 })).rejects.toThrow(
      /Invalid cursor format/,
    );
  });
});

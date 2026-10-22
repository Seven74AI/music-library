/**
 * Unit tests for Personal Play Boost formula (ADR-028).
 * Formula must stay documented here and in personal-play-boost.server.ts.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  PLAY_BOOST_CAP,
  PLAY_BOOST_WEIGHT,
  computePersonalPlayBoost,
  getLifetimePlayCompletedCounts,
  personalPlayBoostCaseSql,
} from "#app/utils/personal-play-boost.server.ts";

describe("computePersonalPlayBoost", () => {
  it("documents boost = min(WEIGHT * ln(1 + playCount), CAP)", () => {
    expect(PLAY_BOOST_WEIGHT).toBe(8);
    expect(PLAY_BOOST_CAP).toBe(40);
    // Cap must stay well below one relevance_rank tier (1000).
    expect(PLAY_BOOST_CAP).toBeLessThan(1000);
  });

  it("returns 0 for zero or non-positive counts", () => {
    expect(computePersonalPlayBoost(0)).toBe(0);
    expect(computePersonalPlayBoost(-3)).toBe(0);
    expect(computePersonalPlayBoost(Number.NaN)).toBe(0);
  });

  it("applies WEIGHT * ln(1 + count) before the cap", () => {
    const count = 5;
    const expected = PLAY_BOOST_WEIGHT * Math.log(1 + count);
    expect(computePersonalPlayBoost(count)).toBeCloseTo(expected, 10);
    expect(expected).toBeLessThan(PLAY_BOOST_CAP);
  });

  it("caps boost so plays cannot cross a relevance_rank tier", () => {
    expect(computePersonalPlayBoost(10_000)).toBe(PLAY_BOOST_CAP);
    expect(computePersonalPlayBoost(10_000)).toBeLessThan(1000);
  });

  it("builds a CASE SQL expression from precomputed boosts", () => {
    const sql = personalPlayBoostCaseSql(
      new Map([
        ["track_a", 5],
        ["track_b", 0],
      ]),
    );
    const boostA = computePersonalPlayBoost(5);
    expect(sql).toContain(`WHEN 'track_a' THEN ${boostA}`);
    expect(sql).not.toContain("track_b");
    expect(personalPlayBoostCaseSql(new Map())).toBe("0");
  });
});

describe("getLifetimePlayCompletedCounts", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.user.deleteMany();
  });

  it("aggregates personal lifetime play_completed counts by trackId", async () => {
    const timestamp = Date.now();
    const localService = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: {
        name: "local",
        displayName: "Local Upload",
        baseUrl: "",
        isActive: true,
      },
    });
    const user = await prisma.user.create({
      data: { email: `counts-${timestamp}@test.com`, username: `counts-${timestamp}` },
    });
    const other = await prisma.user.create({
      data: {
        email: `counts-other-${timestamp}@test.com`,
        username: `counts-other-${timestamp}`,
      },
    });
    const artist = await prisma.artist.create({
      data: { name: "Counts Artist", normalizedName: "counts artist" },
    });
    const track = await prisma.track.create({
      data: {
        title: "Counts Track",
        artistId: artist.id,
        serviceId: localService.id,
        externalId: `counts-track-${timestamp}`,
      },
    });

    for (let i = 0; i < 3; i++) {
      await prisma.usageEvent.create({
        data: {
          type: USAGE_EVENT_TYPES.play_completed,
          userId: user.id,
          trackId: track.id,
        },
      });
    }
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_started,
        userId: user.id,
        trackId: track.id,
      },
    });
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId: other.id,
        trackId: track.id,
      },
    });

    const counts = await getLifetimePlayCompletedCounts(user.id);
    expect(counts.get(track.id)).toBe(3);
  });
});

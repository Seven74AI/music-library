/**
 * Personal Play Boost (ADR-028 / decision #65)
 *
 * Soft-ranks global FTS *track* hits using the current user's lifetime
 * `play_completed` UsageEvent counts. Relevance stays primary; plays only
 * nudge already-matching tracks within (never across) relevance tiers.
 *
 * Score direction: lower is better (matches existing FTS relevance packing).
 *
 * Formula (documented + tested):
 *   boost = min(PLAY_BOOST_WEIGHT * ln(1 + playCount), PLAY_BOOST_CAP)
 *   effective_fts = fts_rank - boost
 *   relevance   = relevance_rank * 1000 + effective_fts
 *
 * Cap is well below one relevance_rank tier (1000), so an exact match with
 * zero plays still outranks a contains match with unbounded plays.
 */

import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { cache, cachified } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";

/** Multiplier on ln(1 + playCount). Tuned so modest listens move the needle. */
export const PLAY_BOOST_WEIGHT = 8;

/**
 * Max boost subtracted from FTS rank. Must stay << 1000 (one relevance_rank
 * tier) so plays cannot hard-override exact > prefix > contains.
 */
export const PLAY_BOOST_CAP = 40;

/** Cache lifetime play counts briefly; search results also cache separately. */
const LIFETIME_PLAY_COUNTS_TTL_MS = 60 * 1000;

/**
 * Bounded soft boost for a single track's lifetime completed-play count.
 * Returns 0 for missing/zero plays; never exceeds PLAY_BOOST_CAP.
 */
export function computePersonalPlayBoost(playCount: number): number {
  if (!Number.isFinite(playCount) || playCount <= 0) {
    return 0;
  }
  return Math.min(PLAY_BOOST_WEIGHT * Math.log(1 + playCount), PLAY_BOOST_CAP);
}

/**
 * Lifetime `play_completed` counts by trackId for one user.
 * Cached briefly so authed search paths do not re-aggregate on every keystroke.
 */
export async function getLifetimePlayCompletedCounts(userId: string): Promise<Map<string, number>> {
  const record = await cachified({
    key: `lifetime-play-completed:${userId}`,
    cache,
    ttl: LIFETIME_PLAY_COUNTS_TTL_MS,
    getFreshValue: async (): Promise<Record<string, number>> => {
      const rows = await prisma.usageEvent.groupBy({
        by: ["trackId"],
        where: {
          userId,
          type: USAGE_EVENT_TYPES.play_completed,
          trackId: { not: null },
        },
        _count: { _all: true },
      });

      const out: Record<string, number> = {};
      for (const row of rows) {
        if (row.trackId) {
          out[row.trackId] = row._count._all;
        }
      }
      return out;
    },
  });

  return new Map(Object.entries(record));
}

/**
 * SQL CASE expression: per-track boost from a preloaded lifetime count map.
 * Uses {@link computePersonalPlayBoost} so JS and SQL stay in lockstep.
 */
export function personalPlayBoostCaseSql(playCounts: Map<string, number>): string {
  if (playCounts.size === 0) {
    return "0";
  }

  const branches: string[] = [];
  for (const [trackId, count] of playCounts) {
    const boost = computePersonalPlayBoost(count);
    if (boost <= 0) continue;
    const escapedId = trackId.replace(/'/g, "''");
    branches.push(`WHEN '${escapedId}' THEN ${boost}`);
  }

  if (branches.length === 0) {
    return "0";
  }

  return `CASE t.id ${branches.join(" ")} ELSE 0 END`;
}

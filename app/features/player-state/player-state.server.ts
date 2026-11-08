import { z } from "zod";
import { clampShuffleSeed } from "#app/features/queue/queue-shuffle.ts";
import { prisma } from "#app/utils/db.server.ts";
import { PLAYLIST_TRACK_SORT_OPTIONS } from "#app/utils/playlist-track-sort.ts";
import { LIBRARY_SORT_OPTIONS } from "#app/features/listening-insights/heavy-rotation.ts";
import { DISCOVER_SORT_OPTIONS } from "#app/utils/discover.ts";
import { type PlayContextJson, type PlayerStateData } from "./player-state.ts";

const playlistSortSchema = z.enum(PLAYLIST_TRACK_SORT_OPTIONS);
const librarySortSchema = z.enum(LIBRARY_SORT_OPTIONS);
const discoverSortSchema = z.enum(DISCOVER_SORT_OPTIONS);
const sortDirectionSchema = z.enum(["asc", "desc"]);

// Internal DB ids are ~25-char cuids; cap the length and the Up Next array so a
// client can't persist an arbitrarily large queue into the stored JSON column.
const idSchema = z.string().min(1).max(200);

const playContextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("library"),
    sort: librarySortSchema.optional(),
    direction: sortDirectionSchema.optional(),
  }),
  z.object({
    type: z.literal("playlist"),
    playlistId: idSchema,
    sort: playlistSortSchema.optional(),
    direction: sortDirectionSchema.optional(),
  }),
  z.object({ type: z.literal("artist"), artistId: idSchema }),
  z.object({ type: z.literal("album"), albumId: idSchema }),
  z.object({ type: z.literal("track"), trackId: idSchema }),
  z.object({ type: z.literal("onRepeatSnapshot"), snapshotId: idSchema }),
  z.object({
    type: z.literal("discover"),
    sort: discoverSortSchema.optional(),
    direction: sortDirectionSchema.optional(),
  }),
]);

const playerStateSchema = z.object({
  playContext: playContextSchema.nullable(),
  currentTrackId: idSchema.nullable(),
  upNextIds: z.array(idSchema).max(1000),
  shuffleSeed: z.number().int().nullable(),
  loopMode: z.enum(["off", "all", "one"]),
});

const DEFAULT_PLAYER_STATE: PlayerStateData = {
  playContext: null,
  currentTrackId: null,
  upNextIds: [],
  shuffleSeed: null,
  loopMode: "off",
};

/** Validate an untrusted request body into a `PlayerStateData`. */
export function parsePlayerState(input: unknown) {
  return playerStateSchema.safeParse(input);
}

function parseStoredPlayerStateRow(row: {
  playContext: string | null;
  currentTrackId: string | null;
  upNextIds: string;
  shuffleSeed: number | null;
  loopMode: string;
}): PlayerStateData {
  let playContext: unknown = null;
  if (row.playContext) {
    try {
      playContext = JSON.parse(row.playContext) as unknown;
    } catch {
      playContext = null;
    }
  }

  let upNextIds: unknown = [];
  try {
    upNextIds = JSON.parse(row.upNextIds) as unknown;
  } catch {
    upNextIds = [];
  }

  const parsed = playerStateSchema.safeParse({
    playContext,
    currentTrackId: row.currentTrackId,
    upNextIds,
    shuffleSeed: row.shuffleSeed,
    loopMode: row.loopMode,
  });

  if (!parsed.success) {
    return DEFAULT_PLAYER_STATE;
  }

  return {
    ...parsed.data,
    shuffleSeed:
      parsed.data.shuffleSeed === null ? null : clampShuffleSeed(parsed.data.shuffleSeed),
  };
}

/** One row per user — upsert on the unique `userId`. */
export async function savePlayerState(userId: string, data: PlayerStateData): Promise<void> {
  const playContext = data.playContext ? JSON.stringify(data.playContext) : null;
  const upNextIds = JSON.stringify(data.upNextIds);
  const shuffleSeed = data.shuffleSeed === null ? null : clampShuffleSeed(data.shuffleSeed);

  await prisma.playerState.upsert({
    where: { userId },
    create: {
      userId,
      playContext,
      currentTrackId: data.currentTrackId,
      upNextIds,
      shuffleSeed,
      loopMode: data.loopMode,
    },
    update: {
      playContext,
      currentTrackId: data.currentTrackId,
      upNextIds,
      shuffleSeed,
      loopMode: data.loopMode,
    },
  });
}

/** Read the user's saved queue, or `null` when none has been persisted yet. */
export async function getPlayerState(userId: string): Promise<PlayerStateData | null> {
  const row = await prisma.playerState.findUnique({ where: { userId } });
  if (!row) return null;

  return parseStoredPlayerStateRow(row);
}

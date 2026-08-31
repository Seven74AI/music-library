import { z } from "zod";
import { type LoopMode } from "#app/features/queue/queue-navigation.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type PlayContextJson, type PlayerStateData } from "./player-state.ts";

const playContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("library") }),
  z.object({ type: z.literal("playlist"), playlistId: z.string().min(1) }),
  z.object({ type: z.literal("artist"), artistId: z.string().min(1) }),
  z.object({ type: z.literal("album"), albumId: z.string().min(1) }),
  z.object({ type: z.literal("track"), trackId: z.string().min(1) }),
]);

const playerStateSchema = z.object({
  playContext: playContextSchema.nullable(),
  currentTrackId: z.string().min(1).nullable(),
  upNextIds: z.array(z.string().min(1)),
  shuffleSeed: z.number().int().nullable(),
  loopMode: z.enum(["off", "all", "one"]),
});

/** Validate an untrusted request body into a `PlayerStateData`. */
export function parsePlayerState(input: unknown) {
  return playerStateSchema.safeParse(input);
}

function safeParseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // fall through
  }
  return [];
}

function safeParsePlayContext(raw: string | null): PlayContextJson | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = playContextSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** One row per user — upsert on the unique `userId`. */
export async function savePlayerState(userId: string, data: PlayerStateData): Promise<void> {
  const playContext = data.playContext ? JSON.stringify(data.playContext) : null;
  const upNextIds = JSON.stringify(data.upNextIds);

  await prisma.playerState.upsert({
    where: { userId },
    create: {
      userId,
      playContext,
      currentTrackId: data.currentTrackId,
      upNextIds,
      shuffleSeed: data.shuffleSeed,
      loopMode: data.loopMode,
    },
    update: {
      playContext,
      currentTrackId: data.currentTrackId,
      upNextIds,
      shuffleSeed: data.shuffleSeed,
      loopMode: data.loopMode,
    },
  });
}

/** Read the user's saved queue, or `null` when none has been persisted yet. */
export async function getPlayerState(userId: string): Promise<PlayerStateData | null> {
  const row = await prisma.playerState.findUnique({ where: { userId } });
  if (!row) return null;

  return {
    playContext: safeParsePlayContext(row.playContext),
    currentTrackId: row.currentTrackId,
    upNextIds: safeParseStringArray(row.upNextIds),
    shuffleSeed: row.shuffleSeed,
    loopMode: (row.loopMode as LoopMode) ?? "off",
  };
}

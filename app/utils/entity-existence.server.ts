import { prisma } from "./db.server.ts";

export type CuratorEntityType = "track" | "artist" | "album";

/**
 * Verify that a curator-reviewable entity (track, artist, or album) exists.
 *
 * Used by the review-queue flag/report and curator-notes routes so existence
 * checks stay in one place and don't drift between `findUnique` calls with
 * different select shapes.
 */
export async function verifyEntityExists(
  entityType: CuratorEntityType,
  entityId: string,
): Promise<boolean> {
  switch (entityType) {
    case "track": {
      const track = await prisma.track.findUnique({
        where: { id: entityId },
        select: { id: true },
      });
      return track !== null;
    }
    case "artist": {
      const artist = await prisma.artist.findUnique({
        where: { id: entityId },
        select: { id: true },
      });
      return artist !== null;
    }
    case "album": {
      const album = await prisma.album.findUnique({
        where: { id: entityId },
        select: { id: true },
      });
      return album !== null;
    }
  }
}

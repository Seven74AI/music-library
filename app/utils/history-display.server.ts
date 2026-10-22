import { prisma } from "#app/utils/db.server.ts";
import {
  collectRelationIds,
  coverLabel,
  displayLabels,
  type HistoryChange,
  type HistoryLabel,
} from "./history-display.ts";

export async function labelsForChangeSets(
  changeSets: Array<Record<string, HistoryChange>>,
): Promise<Array<Record<string, HistoryLabel> | undefined>> {
  const ids = collectRelationIds(changeSets);
  const [artists, albums, covers] = await Promise.all([
    ids.artistIds.length
      ? prisma.artist.findMany({
          where: { id: { in: ids.artistIds } },
          select: { id: true, name: true },
        })
      : [],
    ids.albumIds.length
      ? prisma.album.findMany({
          where: { id: { in: ids.albumIds } },
          select: { id: true, name: true },
        })
      : [],
    ids.coverIds.length
      ? prisma.coverImage.findMany({
          where: { id: { in: ids.coverIds } },
          select: { id: true, width: true, height: true },
        })
      : [],
  ]);

  const names = {
    artist: new Map(artists.map((artist) => [artist.id, artist.name])),
    album: new Map(albums.map((album) => [album.id, album.name])),
    cover: new Map(covers.map((cover) => [cover.id, coverLabel(cover)])),
  };

  return changeSets.map((changes) => displayLabels(changes, names));
}

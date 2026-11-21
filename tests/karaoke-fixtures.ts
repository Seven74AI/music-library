import { parseString } from "set-cookie-parser";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createTrack, createUser } from "./db-utils.ts";

export async function createUserWithCookie() {
  const user = await prisma.user.create({
    select: { id: true },
    data: { ...createUser(), roles: { connect: { name: "user" } } },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: { expirationDate: getSessionExpirationDate(), userId: user.id },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsed = parseString(await authSessionStorage.commitSession(authSession))!;
  return { user, cookie: `${parsed.name}=${parsed.value}` };
}

/** Track (optionally with audio) and a TrackKaraoke whose current version has the given shape. */
export async function createKaraokeTrack(
  title: string,
  opts: {
    audio?: boolean;
    version?: { status: "ready" | "draft"; language?: "en" | "fr"; video?: boolean } | null;
  } = {},
) {
  const track = await createTrack(title);
  if (opts.audio ?? true) {
    await prisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        serviceId: track.serviceId,
        objectKey: `audio/tracks/local/${track.id}.mp3`,
        format: "mp3",
      },
    });
  }
  const karaoke = await prisma.trackKaraoke.create({ data: { trackId: track.id } });
  if (opts.version) {
    const v = opts.version;
    const video =
      (v.video ?? v.status === "ready")
        ? await prisma.trackVideoFile.create({
            data: {
              trackId: track.id,
              serviceId: track.serviceId,
              objectKey: `video/tracks/${track.id}.mp4`,
            },
          })
        : null;
    const version = await prisma.trackKaraokeVersion.create({
      data: {
        trackId: track.id,
        language: v.language ?? "en",
        source: "paste",
        lyricsText: "la",
        lines: "[]",
        status: v.status,
        videoFileId: video?.id ?? null,
      },
    });
    await prisma.trackKaraoke.update({
      where: { id: karaoke.id },
      data: { currentVersionId: version.id },
    });
  }
  return track;
}

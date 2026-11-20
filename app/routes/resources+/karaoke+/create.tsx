import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  dispatchGeneration,
  KaraokeConfigError,
  recordJobError,
} from "#app/features/karaoke-generation/dispatch.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/create.ts";

export const CreateKaraokeSchema = z
  .object({
    trackId: z.string().min(1),
    language: z.enum(["en", "fr"]),
    textSource: z.enum(["paste", "whisper", "az-genius", "track-lyrics"]),
    text: z.string().optional(),
    videoFileId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.textSource !== "whisper" && !v.text?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "text is required",
      });
    }
  });

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Create a draft karaoke version + pending generation job, then dispatch. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  if (process.env.KARAOKE_GENERATION_ENABLED !== "true") {
    return data(
      { success: false, error: "Karaoke generation is disabled" },
      { status: 503 },
    );
  }
  const form = await request.formData();
  const parsed = CreateKaraokeSchema.safeParse(
    Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    return data(
      { success: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { trackId, language, textSource, videoFileId } = parsed.data;
  const text = textSource === "whisper" ? null : (parsed.data.text ?? null);

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true },
  });
  if (!track)
    return data({ success: false, error: "Track not found" }, { status: 404 });

  if (videoFileId) {
    const videoFile = await prisma.trackVideoFile.findUnique({
      where: { id: videoFileId },
      select: { trackId: true },
    });
    if (!videoFile || videoFile.trackId !== trackId) {
      return data(
        { success: false, error: "videoFileId does not belong to this track" },
        { status: 400 },
      );
    }
  }

  const create = () =>
    prisma.$transaction(async (tx) => {
      await tx.trackKaraoke.upsert({
        where: { trackId },
        update: {},
        create: { trackId },
      });
      // lyricsText/lines columns are NOT NULL: whisper → "" until the pipeline transcribes.
      const createdVersion = await tx.trackKaraokeVersion.create({
        data: {
          trackId,
          language,
          source: textSource,
          lyricsText: text ?? "",
          lines: "[]",
          videoFileId: videoFileId ?? null,
          status: "draft",
          createdBy: userId,
        },
      });
      const createdJob = await tx.karaokeGenerationJob.create({
        data: { versionId: createdVersion.id, status: "pending" },
      });
      return { version: createdVersion, job: createdJob };
    });

  let created: Awaited<ReturnType<typeof create>>;
  try {
    created = await create();
  } catch (error) {
    // Concurrent creates can collide on the TrackKaraoke upsert (unique
    // constraint) or hit SQLite busy; the whole transaction rolled back, retry once.
    if (!isTransientWriteConflict(error)) throw error;
    created = await create();
  }
  const { version, job } = created;

  try {
    await dispatchGeneration(
      job.id,
      { id: version.id, trackId, videoFileId: version.videoFileId },
      language,
      text,
    );
  } catch (error) {
    // Config errors can't succeed on retry → fail now. Otherwise the job stays
    // `pending` and the reconciler re-dispatches it with backoff.
    await recordJobError(job.id, error, error instanceof KaraokeConfigError);
  }
  return data({ success: true, versionId: version.id });
}

function isTransientWriteConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2002" || code === "P2034" || code === "P1008") return true;
  return /database is locked|SQLITE_BUSY|Unique constraint/i.test(
    error instanceof Error ? error.message : "",
  );
}

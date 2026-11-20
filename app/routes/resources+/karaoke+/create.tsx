import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  dispatchGeneration,
  recordJobError,
} from "#app/features/karaoke-generation/dispatch.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";

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

/** Create a draft karaoke version + pending generation job, then dispatch. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
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

  const { version, job } = await prisma.$transaction(async (tx) => {
    await tx.trackKaraoke.upsert({
      where: { trackId },
      update: {},
      create: { trackId },
    });
    // lyricsText/lines columns are NOT NULL: whisper → "" until the pipeline transcribes.
    const version = await tx.trackKaraokeVersion.create({
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
    const job = await tx.karaokeGenerationJob.create({
      data: { versionId: version.id, status: "pending" },
    });
    return { version, job };
  });

  try {
    await dispatchGeneration(
      job.id,
      { id: version.id, trackId, videoFileId: version.videoFileId },
      language,
      text,
    );
  } catch (error) {
    // Job stays `pending` with the error recorded; the version still exists.
    await recordJobError(job.id, error);
  }
  return data({ success: true, versionId: version.id });
}

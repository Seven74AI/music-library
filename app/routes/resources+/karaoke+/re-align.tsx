import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  dispatchGeneration,
  KaraokeConfigError,
  recordJobError,
} from "#app/features/karaoke-generation/dispatch.server.ts";
import {
  jsonError,
  requireKaraokeEditLock,
} from "#app/features/karaoke-generation/versions.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/re-align.ts";

export const ReAlignSchema = z.object({
  versionId: z.string().min(1),
  text: z.string().max(50_000).optional(),
});

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** New draft copy of the source (optionally new text) + a new generation job. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  if (process.env.KARAOKE_GENERATION_ENABLED !== "true") {
    return jsonError("Karaoke generation is disabled", 503);
  }
  const form = await request.formData();
  const parsed = ReAlignSchema.safeParse(
    Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")),
  );
  if (!parsed.success) {
    return data(
      { success: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const source = await prisma.trackKaraokeVersion.findUnique({
    where: { id: parsed.data.versionId },
  });
  if (!source) return jsonError("Version not found", 404);

  const blocked = await requireKaraokeEditLock(source.trackId, userId);
  if (blocked) return blocked;

  const text = parsed.data.text ?? source.lyricsText;
  const { version, job } = await prisma.$transaction(async (tx) => {
    const version = await tx.trackKaraokeVersion.create({
      data: {
        trackId: source.trackId,
        language: source.language,
        source: source.source,
        videoFileId: source.videoFileId,
        lyricsText: text,
        lines: "[]",
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
      {
        id: version.id,
        trackId: version.trackId,
        videoFileId: version.videoFileId,
      },
      version.language,
      // No text to align → let the pipeline transcribe.
      text.trim() ? text : null,
    );
  } catch (error) {
    await recordJobError(job.id, error, error instanceof KaraokeConfigError);
  }
  return data({ success: true, versionId: version.id, jobId: job.id });
}

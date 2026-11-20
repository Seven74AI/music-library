import { serializeKaraokeLines } from "#app/features/track-video/karaoke-lines.ts";
import { prisma } from "#app/utils/db.server.ts";

/**
 * Apply a generation result to the version and mark the job completed.
 * Idempotent: an already-completed job is a no-op. Never marks the version
 * `ready` (the editor does that). Throws on invalid lines.
 */
export async function completeGenerationJob(
  jobId: string,
  result: { lines: unknown; text?: string | undefined },
): Promise<{ applied: boolean }> {
  const lines = serializeKaraokeLines(result.lines);
  return prisma.$transaction(async (tx) => {
    const job = await tx.karaokeGenerationJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.status === "completed") return { applied: false };
    await tx.trackKaraokeVersion.update({
      where: { id: job.versionId },
      data: {
        lines,
        ...(result.text !== undefined ? { lyricsText: result.text } : {}),
      },
    });
    await tx.karaokeGenerationJob.update({
      where: { id: jobId },
      data: { status: "completed" },
    });
    return { applied: true };
  });
}

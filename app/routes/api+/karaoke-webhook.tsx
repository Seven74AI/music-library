import crypto from "node:crypto";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { completeGenerationJob } from "#app/features/karaoke-generation/complete-job.server.ts";
import { validateKaraokeLines } from "#app/features/track-video/karaoke-lines.ts";
import { prisma } from "#app/utils/db.server.ts";

const BodySchema = z.object({
  providerJobId: z.string().min(1),
  versionId: z.string().min(1),
  lines: z.unknown(),
  text: z.string().optional(),
});

function secretMatches(provided: string | null): boolean {
  const secret = process.env.KARAOKE_WEBHOOK_SECRET;
  if (!secret || !provided) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Authed (shared-secret header) result callback from the generation provider. */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return data({ error: "Method not allowed" }, { status: 405 });
  if (!secretMatches(request.headers.get("x-karaoke-webhook-secret"))) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return data({ error: "Invalid body" }, { status: 400 });
  const { providerJobId, versionId, lines, text } = parsed.data;

  const job = await prisma.karaokeGenerationJob.findFirst({
    where: { providerJobId, versionId },
  });
  if (!job) return data({ error: "Unknown job" }, { status: 404 });

  const check = validateKaraokeLines(lines);
  if (!check.success) return data({ error: "Invalid lines" }, { status: 400 });

  const { applied } = await completeGenerationJob(job.id, {
    lines: check.data,
    text,
  });
  return data({ success: true, applied });
}

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  jsonError,
  requireKaraokeEditLock,
} from "#app/features/karaoke-generation/versions.server.ts";
import { karaokeLinesSchema } from "#app/features/track-video/karaoke-lines.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/save-edit.ts";

export const SaveEditSchema = z.object({
  versionId: z.string().min(1),
  text: z.string().max(50_000),
  lines: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "lines must be valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(karaokeLinesSchema),
});

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Copy-on-write: creates a NEW draft version; the source row is never touched. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const parsed = SaveEditSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    return data(
      { success: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { versionId, text, lines } = parsed.data;
  const source = await prisma.trackKaraokeVersion.findUnique({
    where: { id: versionId },
  });
  if (!source) return jsonError("Version not found", 404);

  const blocked = await requireKaraokeEditLock(source.trackId, userId);
  if (blocked) return blocked;

  const created = await prisma.trackKaraokeVersion.create({
    data: {
      trackId: source.trackId,
      language: source.language,
      source: source.source,
      videoFileId: source.videoFileId,
      lyricsText: text,
      lines: JSON.stringify(lines),
      status: "draft",
      createdBy: userId,
    },
    select: { id: true },
  });
  return data({ success: true, versionId: created.id });
}

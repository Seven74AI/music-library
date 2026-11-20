import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  casRepointCurrentVersion,
  jsonError,
  karaokeLockBlocker,
} from "#app/features/karaoke-generation/versions.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/mark-ready.ts";

export const MarkReadySchema = z.object({ versionId: z.string().min(1) });

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Publish: mark the version ready and CAS-repoint TrackKaraoke.currentVersionId. */
export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const parsed = MarkReadySchema.safeParse(
    Object.fromEntries((await request.formData()).entries()),
  );
  if (!parsed.success) {
    return data(
      { success: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const version = await prisma.trackKaraokeVersion.findUnique({
    where: { id: parsed.data.versionId },
    select: { id: true, trackId: true },
  });
  if (!version) return jsonError("Version not found", 404);
  const blocked = await karaokeLockBlocker(version.trackId, userId);
  if (blocked) return blocked;

  const result = await casRepointCurrentVersion(version.trackId, version.id);
  if (!result.ok) return jsonError("Karaoke changed concurrently; retry", 409);
  return data({
    success: true,
    trackId: version.trackId,
    currentVersionId: version.id,
    previousVersionId: result.previousVersionId,
  });
}

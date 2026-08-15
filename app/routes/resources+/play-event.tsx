import { data } from "react-router";
import { z } from "zod";
import { consumePlayEventBudget } from "#app/features/usage-analytics/play-event-rate-limit.server.ts";
import {
  recordUsageEvent,
  USAGE_EVENT_TYPES,
} from "#app/features/usage-analytics/record-usage.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/play-event.ts";

const PlayEventSchema = z.object({
  type: z.enum([USAGE_EVENT_TYPES.play_started, USAGE_EVENT_TYPES.play_completed]),
  trackId: z.string().min(1),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const { allowed, retryAfterSeconds } = consumePlayEventBudget(userId);
  if (!allowed) {
    return data(
      { ok: false, error: "Too many play events" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const formData = await request.formData();
  const parsed = PlayEventSchema.safeParse({
    type: formData.get("type"),
    trackId: formData.get("trackId"),
  });

  if (!parsed.success) {
    return data({ ok: false, error: "Invalid play event" }, { status: 400 });
  }

  // Without this, any authenticated user could inflate play metrics with
  // arbitrary ids, since UsageEvent.trackId carries no foreign key.
  const track = await prisma.track.findUnique({
    where: { id: parsed.data.trackId },
    select: { id: true },
  });
  if (!track) {
    return data({ ok: false, error: "Unknown track" }, { status: 400 });
  }

  await recordUsageEvent({
    type: parsed.data.type,
    userId,
    trackId: track.id,
  });

  return data({ ok: true });
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

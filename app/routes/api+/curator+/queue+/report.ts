import { data } from "react-router";
import { z } from "zod";
import { createOrUpdateQueueItem } from "#app/features/curator/review-queue.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { verifyEntityExists } from "#app/utils/entity-existence.server.ts";
import { makeRateLimiter } from "#app/utils/rate-limit.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/report";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

/** Per-user report submissions allowed per minute (ASVS high-value endpoint cap). */
export const REPORT_RATE_LIMIT_PER_MINUTE = 10;

const reportSchema = z.object({
  trackId: z.string().min(1),
  issueType: z.enum(["wrong_metadata", "missing_info", "low_quality", "duplicate", "other"]),
  description: z.string().min(1).max(1000),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const budget = makeRateLimiter("track-report", REPORT_RATE_LIMIT_PER_MINUTE).consume(userId);
  if (!budget.allowed) {
    return data(
      {
        success: false,
        error: "Too many reports. Please try again later.",
        retryAfterSeconds: budget.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  try {
    const formData = await request.formData();
    const rawData = Object.fromEntries(formData);
    const validatedData = reportSchema.parse(rawData);

    // Verify track exists
    const trackExists = await verifyEntityExists("track", validatedData.trackId);

    if (!trackExists) {
      return data({ success: false, error: "Track not found" }, { status: 404 });
    }

    // Idempotent upsert: a second report for the same open (track, issueType)
    // increments the existing item's reportCount instead of creating a duplicate.
    await createOrUpdateQueueItem({
      entityType: "track",
      entityId: validatedData.trackId,
      source: "user_report",
      issueType: validatedData.issueType,
      description: validatedData.description,
      reporterId: userId,
      priority: 1,
    });

    return data({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return data({ success: false, error: "Invalid input data" }, { status: 400 });
    }
    console.error("Error creating review queue item:", error);
    return data({ success: false, error: "Failed to submit report" }, { status: 500 });
  }
}

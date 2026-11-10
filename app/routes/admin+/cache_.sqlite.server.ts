import { timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import { z } from "zod";
import { cache } from "#app/utils/cache.server.ts";
import { getInstanceInfo } from "#app/utils/litefs.server";
import { type Route } from "./+types/cache_.sqlite.ts";

function bearerIsAuthorized(authorization: string | null, token: string | undefined) {
  if (!authorization || !token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const provided = Buffer.from(authorization);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function action({ request }: Route.ActionArgs) {
  const { currentIsPrimary, primaryInstance } = await getInstanceInfo();
  if (!currentIsPrimary) {
    throw new Error(
      `${request.url} should only be called on the primary instance (${primaryInstance})}`,
    );
  }
  const token = process.env.INTERNAL_COMMAND_TOKEN;
  const isAuthorized = bearerIsAuthorized(request.headers.get("Authorization"), token);
  if (!isAuthorized) {
    // Reject with 401 (not a redirect) so replica->primary sync failures are
    // visible as non-2xx responses instead of silently following a rickroll.
    return data({ error: "Unauthorized" }, { status: 401 });
  }
  const { key, cacheValue } = z
    .object({ key: z.string(), cacheValue: z.unknown().optional() })
    .parse(await request.json());
  if (cacheValue === undefined) {
    await cache.delete(key);
  } else {
    // @ts-expect-error - we don't reliably know the type of cacheValue
    await cache.set(key, cacheValue);
  }
  return { success: true };
}

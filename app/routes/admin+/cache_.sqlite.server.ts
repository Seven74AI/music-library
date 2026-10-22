import { timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import { z } from "zod";
import { cache } from "#app/utils/cache.server.ts";
import { getInstanceInfo, getInternalInstanceDomain } from "#app/utils/litefs.server";
import { type Route } from "./+types/cache_.sqlite.ts";

function bearerIsAuthorized(authorization: string | null, token: string | undefined) {
  if (!authorization || !token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const provided = Buffer.from(authorization);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function updatePrimaryCacheValue({
  key,
  cacheValue,
}: {
  key: string;
  cacheValue: any;
}) {
  const { currentIsPrimary, primaryInstance } = await getInstanceInfo();
  if (currentIsPrimary) {
    throw new Error(
      `updatePrimaryCacheValue should not be called on the primary instance (${primaryInstance})}`,
    );
  }
  const domain = getInternalInstanceDomain(primaryInstance);
  const token = process.env.INTERNAL_COMMAND_TOKEN;
  return fetch(`${domain}/admin/cache/sqlite`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, cacheValue }),
    // Do not follow the 401/redirect the primary returns on a bad token —
    // otherwise fetch() lands on a 200 HTML page and the caller sees a
    // misleading success.
    redirect: "manual",
  });
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

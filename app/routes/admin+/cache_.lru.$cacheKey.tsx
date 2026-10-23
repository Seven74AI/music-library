import { invariantResponse } from "@epic-web/invariant";
import { lruCache } from "#app/utils/cache.server.ts";
import { getAllInstances, getInstanceInfo, ensureInstance } from "#app/utils/litefs.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/cache_.lru.$cacheKey.ts";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");
  const searchParams = new URL(request.url).searchParams;
  const currentInstanceInfo = await getInstanceInfo();
  const allInstances = await getAllInstances();
  const instance = searchParams.get("instance") ?? currentInstanceInfo.currentInstance;
  await ensureInstance(instance);

  const { cacheKey } = params;
  invariantResponse(cacheKey, "cacheKey is required");
  return {
    instance: {
      hostname: instance,
      region: allInstances[instance],
      isPrimary: currentInstanceInfo.primaryInstance === instance,
    },
    cacheKey,
    value: lruCache.get(cacheKey),
  };
}

export default function LruCacheValueRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="container">
      <h1 className="text-h1">LRU cache value</h1>
      <p className="text-muted-foreground font-mono text-body-sm">{loaderData.cacheKey}</p>
      <pre className="font-mono text-body-sm overflow-auto">
        {JSON.stringify(loaderData.value, null, 2)}
      </pre>
    </div>
  );
}

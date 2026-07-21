import { isOfflineEnvironment } from "./is-offline-environment.ts";
import {
  OFFLINE_ROUTE_POLICIES,
  type OfflineClientLoaderArgs,
} from "./offline-route-policies.client.ts";

export { isOfflineEnvironment } from "./is-offline-environment.ts";

function isLikelyNetworkFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|network|load failed|networkerror/i.test(error.message);
}

export { isLikelyNetworkFailure };

export async function loadWithOfflineFallback<TOnline, TOffline = TOnline>(
  serverLoader: () => Promise<TOnline>,
  offlineLoader: () => Promise<TOffline>,
): Promise<TOnline | TOffline> {
  try {
    return await serverLoader();
  } catch (error) {
    if (isOfflineEnvironment() || isLikelyNetworkFailure(error)) {
      return offlineLoader();
    }
    throw error;
  }
}

type CreateOfflineClientLoaderOptions = {
  onlineLoader?: (args: OfflineClientLoaderArgs) => Promise<unknown>;
  offlineLoader?: (args: OfflineClientLoaderArgs) => Promise<unknown>;
};

export type ServerLoaderData<TLoader extends (...args: never[]) => unknown> =
  Awaited<ReturnType<TLoader>> extends { data: infer D; init?: ResponseInit }
    ? D
    : Awaited<ReturnType<TLoader>>;

export function createOfflineClientLoader<TOnline = unknown, TOffline = unknown>(
  routeId: string,
  options?: CreateOfflineClientLoaderOptions,
) {
  const policy = OFFLINE_ROUTE_POLICIES[routeId];
  if (!policy || policy.mode !== "live") {
    throw new Error(`No live offline policy registered for route: ${routeId}`);
  }
  const livePolicy = policy;

  async function clientLoader(args: {
    serverLoader: () => Promise<unknown>;
    params: Record<string, string | undefined>;
    request: Request;
  }): Promise<TOnline | TOffline> {
    const loaderArgs: OfflineClientLoaderArgs = {
      serverLoader: args.serverLoader as () => Promise<unknown>,
      params: args.params,
      request: args.request,
    };
    const onlineLoader =
      options?.onlineLoader ?? livePolicy.onlineLoader ?? (() => args.serverLoader());
    const offlineLoader = options?.offlineLoader ?? livePolicy.offlineLoader;

    return loadWithOfflineFallback<TOnline, TOffline>(
      () => onlineLoader(loaderArgs) as Promise<TOnline>,
      () => offlineLoader(loaderArgs) as Promise<TOffline>,
    );
  }

  clientLoader.hydrate = true as const;
  return clientLoader;
}

export function createDeviceOnlyClientLoader<TOffline = unknown>(routeId: string) {
  const policy = OFFLINE_ROUTE_POLICIES[routeId];
  if (!policy || policy.mode !== "live") {
    throw new Error(`No live offline policy registered for route: ${routeId}`);
  }
  const livePolicy = policy;

  async function clientLoader(): Promise<TOffline> {
    return livePolicy.offlineLoader({
      serverLoader: async () => ({}),
      params: {},
      request: new Request("http://localhost"),
    }) as Promise<TOffline>;
  }

  clientLoader.hydrate = true as const;
  return clientLoader;
}

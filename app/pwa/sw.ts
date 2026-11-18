/// <reference lib="webworker" />

import { NetworkOnly } from "serwist";
import { installSerwist, matchPrecache } from "serwist/legacy";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const NAVIGATE_DENYLIST = [/^\/resources\//, /^\/api\//, /\.data$/];

installSerwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // Disabled: on iOS Safari/PWA, a failed preload fetch surfaces a native
  // "not connected to the internet" error before the offline shell fallback
  // below can run.
  // Don't let the precache route claim navigations: by default it rewrites
  // "/" to the precached "/index.html" (directoryIndex) and serves it
  // cache-first, before the navigation route below is ever reached.
  precacheOptions: { directoryIndex: null, cleanURLs: false },
  navigationPreload: false,
  // No `navigateFallback`: it serves the precached /index.html first, which
  // leaves returning users on a stale shell + old chunks after a deploy.
  // Navigations are network-first instead; the precached shell is used only
  // when the network fails (offline).
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && !NAVIGATE_DENYLIST.some((re) => re.test(url.pathname)),
      // NetworkOnly: SSR HTML is never written to a runtime cache. The
      // precached shell is used only when the network fails (offline).
      handler: new NetworkOnly({
        plugins: [
          {
            handlerDidError: async () => matchPrecache("/index.html"),
          },
        ],
      }),
    },
  ],
});

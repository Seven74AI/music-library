/// <reference lib="webworker" />

import { installSerwist } from "serwist/legacy";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<{ url: string; revision: string | null }>;
};

installSerwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // Disabled: on iOS Safari/PWA, a failed preload fetch surfaces a native
  // "not connected to the internet" error before navigateFallback can serve
  // the cached app shell.
  navigationPreload: false,
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/resources\//, /^\/api\//, /\.data$/],
});

const SW_URL = "/sw.js";

/**
 * Service worker update state for UI notification.
 * `null` = no update available, `true` = update ready (waiting to activate).
 */
let updateReady = false;

/** Callback registered by the app shell to show a reload toast. */
let onUpdateReady: (() => void) | null = null;

export function onServiceWorkerUpdate(callback: () => void) {
  onUpdateReady = callback;
  // If update was already detected before the callback was registered, fire immediately
  if (updateReady) callback();
}

export function isServiceWorkerUpdateReady(): boolean {
  return updateReady;
}

type ServiceWorkerEnv = Partial<Pick<Window["ENV"], "MODE" | "DISABLE_SERVICE_WORKER">>;

/**
 * In development/test, Serwist's navigateFallback serves the offline shell for
 * document navigations and shadows SSR — breaking HydratedRouter. Disable the
 * SW by default outside production; opt back in with DISABLE_SERVICE_WORKER=false.
 */
export function shouldDisableServiceWorker(env: ServiceWorkerEnv = window.ENV): boolean {
  if (env?.DISABLE_SERVICE_WORKER === "true") return true;
  if (env?.DISABLE_SERVICE_WORKER === "false") return false;
  return env?.MODE !== "production";
}

async function unregisterServiceWorkersAndHealOfflineShell() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) return;

  await Promise.all(registrations.map((registration) => registration.unregister()));

  // Leftover SW may have already served the offline shell for this document.
  // Reload once so Express SSR HTML replaces it.
  if (document.documentElement.dataset.offlineShell === "true") {
    window.location.reload();
  }
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  if (shouldDisableServiceWorker()) {
    void unregisterServiceWorkersAndHealOfflineShell();
    return;
  }

  void navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .then((registration) => {
      // If there's already a waiting worker (update detected on previous page load)
      if (registration.waiting) {
        updateReady = true;
        onUpdateReady?.();
        return;
      }

      // Listen for new SW installation
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // New SW installed but waiting — show update toast
            updateReady = true;
            onUpdateReady?.();
          }
        });
      });
    })
    .catch((error) => {
      console.warn("Service worker registration failed:", error);
    });

  // Detect when the waiting SW takes over (e.g., user clicked reload toast)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    updateReady = false;
  });
}

/**
 * Activate the waiting service worker and reload the page.
 * Should be called from the update toast action.
 */
export function activateServiceWorkerUpdate() {
  // Send message to skip waiting doesn't work with serwist's skipWaiting: true,
  // so we just reload — the new SW will claim clients immediately.
  window.location.reload();
}

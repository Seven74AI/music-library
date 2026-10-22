/**
 * Content Security Policy utility module.
 *
 * Generates a Content-Security-Policy header to override Fly.io's bare
 * `default-src 'none'` with explicit script-src and frame-ancestors directives.
 *
 * Uses the existing nonce infrastructure already plumbed through the React tree.
 *
 * `script-src` uses a per-request nonce plus `'strict-dynamic'` (CSP Level 3),
 * which makes the nonce the sole gate for script execution: once a nonced
 * script is allowed, the scripts it imports are trusted transitively, and
 * host allowlists / `'self'` / `'unsafe-inline'` are ignored. Same-origin
 * workers (the `/sw.js` service worker and the OPFS dedicated worker) load
 * through `Worker`/`serviceWorker.register`, not nonced `<script>` tags, so
 * they are granted separately via `worker-src 'self'`.
 */

const DIRECTIVES = {
  "default-src": "'none'",
  "script-src": "'strict-dynamic'",
  "worker-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob: https://i.ytimg.com https://img.youtube.com",
  "connect-src": "'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "font-src": "'self'",
  "media-src": "'self' blob: https://fly.storage.tigris.dev https://*.fly.storage.tigris.dev",
  "manifest-src": "'self'",
  "frame-ancestors": "'none'",
} as const;

/**
 * Generate a Content-Security-Policy header string using the provided nonce.
 *
 * The nonce gates inline script execution — only scripts with a matching nonce
 * attribute are allowed to execute. `'strict-dynamic'` propagates that trust to
 * dynamically imported scripts while ignoring host allowlists. Additional
 * directives allow styles, images, API connections, fonts, and media so the app
 * functions correctly.
 */
export function createCSP(nonce: string, options: { isDev?: boolean } = {}): string {
  const connectSrc = options.isDev
    ? "'self' ws: wss: https://*.ingest.sentry.io https://*.ingest.us.sentry.io"
    : "'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io";

  return [
    `default-src ${DIRECTIVES["default-src"]}`,
    `script-src 'nonce-${nonce}' ${DIRECTIVES["script-src"]}`,
    `worker-src ${DIRECTIVES["worker-src"]}`,
    `style-src ${DIRECTIVES["style-src"]}`,
    `img-src ${DIRECTIVES["img-src"]}`,
    `connect-src ${connectSrc}`,
    `font-src ${DIRECTIVES["font-src"]}`,
    `media-src ${DIRECTIVES["media-src"]}`,
    `manifest-src ${DIRECTIVES["manifest-src"]}`,
    `frame-ancestors ${DIRECTIVES["frame-ancestors"]}`,
  ].join("; ");
}

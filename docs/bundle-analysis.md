# Bundle Analysis — Music Library

**Date:** 2026-05-31 | **Build:** React Router v7 + Vite 6 | **PRD:** https://github.com/Seven74AI/music-library/issues/32

## Summary

| Metric | Value |
|--------|-------|
| Client JS chunks | 127 |
| Client JS raw size | 1,022KB |
| Client JS gzip size | 337KB |
| Client CSS (Tailwind) | 82KB raw |
| Client assets total (incl. CSS, favicons, logos) | 1,780KB raw |
| Server build | 1,232KB |
| 1-byte stubs (empty chunks) | 28 |

## Top-10 Largest Client Chunks

| # | Chunk | Raw | Gzip | Ratio | Category |
|---|-------|-----|------|-------|----------|
| 1 | entry.client-*.js | 183KB | 58KB | 3.2x | Entry point (React hydration + Sentry + browser utils) |
| 2 | chunk-QUQL4437-*.js | 128KB | 43KB | 3.0x | React + React Router + React DOM shared runtime |
| 3 | dropdown-menu-*.js | 64KB | 19KB | 3.4x | Radix UI dropdown menu |
| 4 | playlists._playlistId-*.js | 60KB | 20KB | 3.0x | Playlist detail route |
| 5 | types-*.js | 55KB | 13KB | 4.2x | **Zod runtime library** (entire lib, not just used schemas) |
| 6 | manifest-*.js | 46KB | 4KB | 11.5x | PWA manifest (highly compressible JSON) |
| 7 | root-*.js | 41KB | 14KB | 2.9x | Root layout (CSP nonce, Sentry, nav, footer) |
| 8 | misc-*.js | 31KB | 10KB | 3.1x | Shared utilities + openimg component |
| 9 | parse-*.js | 28KB | 9KB | 3.1x | Parsing utilities (music-metadata, etc.) |
| 10 | index-CBtDYfjo.js | 26KB | 10KB | 2.6x | Index route page |

**Top 10 total:** 662KB raw / 197KB gzip — accounts for 65% raw / 58% gzip of client JS.

## Key Findings

### 1. Zod Runtime: 55KB wasted (reduction potential: ~40KB)

The `types-uPG8Ai6Y.js` chunk is the **entire Zod v3 runtime library** — all validators (string, number, date, bigint, map, set, function, promise, discriminated union), all string format checks (email, UUID, CIDR, emoji, ISO 8601, IP, JWT, base64), all error message strings (dozens of hardcoded English messages), and the full ZodError implementation.

**Only the schema *definitions* (`.object()`, `.string()`, etc.) are used at runtime.** The validators, error formatters, and exotic types (bigint, map, set, function, NaN, promise) are dead code in the client bundle. Zod's tree-shaking is poor because all methods are defined on class prototypes — tree-shakers can't eliminate unused methods on a class.

**Recommendation:** Replace Zod with a lightweight alternative for client-side validation, or use `@conform-to/zod` (already a dependency) which has better tree-shaking. Alternatively, use Zod's `.passthrough()`/`.strip()` only on the server and send pre-validated data to the client.

### 2. 28 Empty Stub Chunks: 28KB overhead

28 routes produce 1-byte stub chunks (robots.txt, sitemap.xml, theme-switch, upload-audio-batch, service-playlist-tracks, etc.). These are `loader`-only routes or resource routes that don't render client components. Each 1-byte chunk still adds:
- A `<link rel="modulepreload">` in the HTML (network round-trip overhead)
- A separate HTTP request (or HTTP/2 push)
- Entry in the Vite manifest

**Recommendation:** Mark these routes with `{ clientLoader: undefined }` or use `shouldRevalidate: () => false` to prevent client-side chunk generation. Alternatively, configure Vite to skip building these routes entirely via the React Router config.

### 3. Radix UI: ~180KB across 10+ chunks

Radix UI primitives are individually chunked but share internal Radix primitives:
- dropdown-menu: 64KB
- select: 20KB
- tooltip: 11KB
- alert-dialog: ~5KB
- checkbox: ~4KB
- accordion, popover, radio-group, slider, scroll-area, progress, etc.

**Recommendation:** Lazy-load complex Radix components (dropdown-menu, select, alert-dialog) behind `React.lazy()` with a suspense boundary. These are interaction-triggered, not first-paint critical.

### 4. Sentry: ~30KB in entry.client (conditionally striped)

The Vite plugin `stripMonitoringWhenNoDSN()` already removes the Sentry monitoring chunk when `SENTRY_DSN` is empty. However, the Sentry React Router integration code in `entry.client.tsx` adds ~30KB even when DSN is empty (the plugin only strips the dynamic import, not the static import).

**Recommendation:** Make the Sentry import itself dynamic only when DSN is present. Currently the plugin removes the conditional `if(ENV.SENTRY_DSN)` block but the `import { Sentry }` at the top of entry.client remains.

### 5. openimg Component: ~31KB in `misc`

The `misc-85oQgU2h.js` chunk contains the `openimg` optimized image component. This is a shared utility chunk pulled into the root layout.

**Recommendation:** Lazy-load the openimg component since it's only used for image-heavy pages (playlist covers, artist images), not the initial page load. Move it to a separate chunk.

### 6. music-metadata / parse: 28KB

The `parse-0e5H-Cba.js` chunk includes music metadata parsing utilities. This should only be loaded on upload pages.

**Recommendation:** Import `music-metadata` only in the upload route, not in shared utilities.

## Tree-Shaking & Lazy-Loading Opportunities

| Opportunity | Est. Savings (gzip) | Effort | Priority |
|-------------|---------------------|--------|----------|
| Replace Zod with lighter alternative or server-only | 30-40KB | Medium | HIGH |
| Eliminate 28 empty stub chunks | 5-10KB overhead | Low | HIGH |
| Lazy-load Radix dropdown-menu + select | 25-30KB | Low | MEDIUM |
| Lazy-load openimg component | 8-12KB | Low | MEDIUM |
| Dynamic Sentry import (only when DSN present) | 10-15KB | Low | MEDIUM |
| Move music-metadata to upload route | 8-12KB | Low | LOW |
| Lazy-load other Radix primitives | 10-15KB | Low | LOW |

**Total potential savings:** 96-134KB gzip (~28-40% reduction from 337KB baseline).

## Recommendations

1. **Immediate (this ticket):** Add CI bundle budget check (warn 600KB, error 800KB gzip).
2. **Next ticket:** Address the top 3 HIGH priorities (Zod, stubs, lazy-load Radix UI).
3. **Follow-up:** Re-measure after optimizations and tighten the budget to 500KB warn / 650KB error.

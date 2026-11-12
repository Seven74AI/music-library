import type { RequestHandler } from "express";

/** Mirrors `configuredSiteUrl` in app/utils/site-url.ts (ADR-002: no server ↔ app imports). */
function siteUrlFromEnv(): string | null {
  const configured = process.env.SITE_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : null;
}

/**
 * Redirect HTTP→HTTPS when Fly reports plain HTTP via Fly-Forwarded-Port (not
 * client-spoofable X-Forwarded-Proto). Redirect target host is taken from SITE_URL
 * only — X-Forwarded-Host is ignored.
 */
export function createHttpsUpgradeMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();
    const flyPort = req.get("Fly-Forwarded-Port");
    if (flyPort !== "80") return next();

    const siteUrl = siteUrlFromEnv();
    if (!siteUrl) return next();

    let allowedHost: string;
    try {
      const parsed = new URL(siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`);
      allowedHost = parsed.host;
    } catch {
      return next();
    }

    res.redirect(302, `https://${allowedHost}${req.originalUrl}`);
  };
}

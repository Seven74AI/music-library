/**
 * Configured public site origin from SITE_URL (safe for client + server bundles).
 */
export function configuredSiteUrl(): string | null {
  const configured = process.env.SITE_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : null;
}

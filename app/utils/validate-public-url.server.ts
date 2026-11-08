import { BlockList, isIP } from "node:net";

const blockedImageAddresses = new BlockList();
blockedImageAddresses.addAddress("0.0.0.0", "ipv4");
blockedImageAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedImageAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedImageAddresses.addSubnet("192.168.0.0", 16, "ipv4");
// Link-local, including cloud metadata (169.254.169.254 and 169.254.170.2).
blockedImageAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedImageAddresses.addAddress("::1", "ipv6");
blockedImageAddresses.addSubnet("fe80::", 10, "ipv6");
blockedImageAddresses.addSubnet("fc00::", 7, "ipv6");

/** Node's URL.hostname keeps the brackets around IPv6 addresses. */
function hostnameForResolution(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isBlockedImageAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedImageAddresses.check(normalized, "ipv4");
  if (family === 6) return blockedImageAddresses.check(normalized, "ipv6");
  return true;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];

  try {
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch (error) {
    // Undici previously surfaced resolver failures as "fetch failed", which retries.
    throw new Error("fetch failed", { cause: error });
  }
}

/**
 * Accept only https URLs whose resolved addresses are public.
 * Returns null for policy rejections so they are not retried.
 */
export async function validatePublicHttpsUrl(rawUrl: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn(`Refusing invalid image URL: ${rawUrl}`);
    return null;
  }

  if (url.protocol !== "https:") {
    console.warn(`Refusing non-https image URL: ${rawUrl}`);
    return null;
  }

  const hostname = hostnameForResolution(url.hostname);
  if (!hostname) {
    console.warn(`Refusing invalid image URL: ${rawUrl}`);
    return null;
  }

  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0 || addresses.some((address) => isBlockedImageAddress(address))) {
    console.warn(`Refusing non-public image URL: ${rawUrl}`);
    return null;
  }

  return url;
}

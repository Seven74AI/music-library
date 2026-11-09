import { BlockList, isIP } from "node:net";

const blockedImageAddresses = new BlockList();
blockedImageAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedImageAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedImageAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedImageAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedImageAddresses.addSubnet("224.0.0.0", 4, "ipv4");
// Link-local, including cloud metadata (169.254.169.254 and 169.254.170.2).
blockedImageAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedImageAddresses.addAddress("::1", "ipv6");
blockedImageAddresses.addAddress("::", "ipv6");
blockedImageAddresses.addSubnet("fe80::", 10, "ipv6");
blockedImageAddresses.addSubnet("fc00::", 7, "ipv6");
blockedImageAddresses.addSubnet("ff00::", 8, "ipv6");
// Well-known NAT64 prefix (RFC 6052) — embeds IPv4 that may be non-public.
blockedImageAddresses.addSubnet("64:ff9b::", 96, "ipv6");

/** Node's URL.hostname keeps the brackets around IPv6 addresses. */
function hostnameForResolution(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function ipv6Hextets(address: string): string[] | null {
  const normalized = address.toLowerCase();
  const [head, tail] = normalized.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail !== undefined ? tail.split(":").filter(Boolean) : [];
  if (tail === undefined && headParts.length !== 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const expanded = [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  if (expanded.length !== 8) return null;
  return expanded;
}

function hextetsToIpv4(highHex: string, lowHex: string): string | null {
  const high = Number.parseInt(highHex, 16);
  const low = Number.parseInt(lowHex, 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/** IPv4 embedded in IPv4-mapped, 6to4, or NAT64 forms. */
function extractEmbeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    return isIP(v4) === 4 ? v4 : null;
  }

  const hextets = ipv6Hextets(lower);
  if (!hextets) return null;

  if (hextets[0] === "2002") {
    return hextetsToIpv4(hextets[1] ?? "0", hextets[2] ?? "0");
  }

  return null;
}

function isBlockedImageAddress(address: string, checkEmbedded = true): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedImageAddresses.check(normalized, "ipv4");
  if (family === 6) {
    const hextets = ipv6Hextets(normalized);
    if (hextets?.[0] === "64" && hextets[1] === "ff9b") return true;
    if (blockedImageAddresses.check(normalized, "ipv6")) return true;
    if (checkEmbedded) {
      const embedded = extractEmbeddedIpv4(normalized);
      if (embedded) return isBlockedImageAddress(embedded, false);
    }
    return false;
  }
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

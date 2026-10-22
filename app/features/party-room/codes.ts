import { ROOM_CODE_CHARSET, ROOM_CODE_LENGTH } from "./constants.ts";

/**
 * Index in [0, max) from Web Crypto, rejecting values that would bias modulo.
 * `crypto.getRandomValues` exists in browsers and Node, so this module can stay
 * in the client bundle (party-room UI imports it).
 */
function randomCharsetIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % max;
}

/**
 * Generate a random room code using the ADR charset.
 * Uniqueness among open rooms is enforced by the caller against the DB.
 *
 * The default draw uses crypto.getRandomValues once per character. Tests can
 * inject `random` (a unit-interval source, same contract as Math.random).
 */
export function generateRoomCode(length: number = ROOM_CODE_LENGTH, random?: () => number): string {
  if (length < 1) {
    throw new Error("Room code length must be at least 1");
  }
  let code = "";
  for (let i = 0; i < length; i++) {
    const index =
      random === undefined
        ? randomCharsetIndex(ROOM_CODE_CHARSET.length)
        : Math.floor(random() * ROOM_CODE_CHARSET.length);
    code += ROOM_CODE_CHARSET[index];
  }
  return code;
}

/** True when the value matches length + charset (case-sensitive). */
export function isValidRoomCode(code: string | null | undefined): boolean {
  if (typeof code !== "string" || code.length !== ROOM_CODE_LENGTH) return false;
  for (const char of code) {
    if (!ROOM_CODE_CHARSET.includes(char)) return false;
  }
  return true;
}

/**
 * Extract a room code from a raw code or a pasted join URL path
 * (e.g. `/rooms/AB3K9Q` or `https://example.com/rooms/AB3K9Q?x=1`).
 */
export function parseRoomCodeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isValidRoomCode(trimmed)) return trimmed;

  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(trimmed, "http://localhost");
    const match = url.pathname.match(/\/rooms\/([A-Z0-9]+)/i);
    if (match?.[1]) {
      const candidate = match[1].toUpperCase();
      return isValidRoomCode(candidate) ? candidate : null;
    }
  } catch {
    // not a URL
  }

  // Bare path like rooms/AB3K9Q
  const pathMatch = trimmed.match(/(?:^|\/)rooms\/([A-Z0-9]+)/i);
  if (pathMatch?.[1]) {
    const candidate = pathMatch[1].toUpperCase();
    return isValidRoomCode(candidate) ? candidate : null;
  }

  return null;
}

export function buildRoomJoinPath(code: string): string {
  return `/rooms/${code}`;
}

export function buildRoomJoinUrl(origin: string, code: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${buildRoomJoinPath(code)}`;
}

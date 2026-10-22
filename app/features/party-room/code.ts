/**
 * Client-oriented room code helpers (logged-in UX).
 * Server/domain generation lives in `codes.ts`.
 */
import {
  buildRoomJoinPath as buildPathFromCodes,
  buildRoomJoinUrl as buildUrlFromCodes,
  isValidRoomCode,
} from "./codes.ts";
import { ROOM_CODE_CHARSET, ROOM_CODE_LENGTH } from "./constants.ts";

export { isValidRoomCode } from "./codes.ts";

/** Normalize pasted codes / URL segments (strip non-charset, uppercase). */
export function normalizeRoomCode(raw: string): string {
  const upper = raw.trim().toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (ROOM_CODE_CHARSET.includes(ch)) out += ch;
  }
  return out.slice(0, ROOM_CODE_LENGTH);
}

/** Extract a room code from a pasted code or full join URL. */
export function parseRoomCodeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const roomsIdx = parts.findIndex((p) => p.toLowerCase() === "rooms");
    if (roomsIdx >= 0 && parts[roomsIdx + 1]) {
      const code = normalizeRoomCode(parts[roomsIdx + 1]!);
      return isValidRoomCode(code) ? code : null;
    }
  } catch {
    // Not a URL — treat as bare code.
  }

  const code = normalizeRoomCode(trimmed);
  return isValidRoomCode(code) ? code : null;
}

export function buildRoomJoinPath(code: string): string {
  return buildPathFromCodes(normalizeRoomCode(code));
}

export function buildRoomJoinUrl(origin: string, code: string): string {
  return buildUrlFromCodes(origin, normalizeRoomCode(code));
}

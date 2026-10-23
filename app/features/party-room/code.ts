/**
 * Client-oriented room code helpers (logged-in UX).
 *
 * These are re-exports of the single server/domain implementation in `codes.ts`.
 * Keeping them here preserves the public import surface (`code.ts`) used by the
 * client while avoiding duplicated, divergent normalization logic.
 */
export {
  buildRoomJoinPath,
  buildRoomJoinUrl,
  isValidRoomCode,
  normalizeRoomCode,
  parseRoomCodeInput,
} from "./codes.ts";

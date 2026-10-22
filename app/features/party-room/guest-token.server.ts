import { createHash, randomBytes } from "node:crypto";
import { createCookie } from "react-router";
import { getSessionSecret } from "#app/utils/env.server.ts";

export const GUEST_TOKEN_COOKIE_NAME = "en_room_guest";

export const guestTokenCookie = createCookie(GUEST_TOKEN_COOKIE_NAME, {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: 60 * 60 * 24, // 24h — rooms are ephemeral
  secure: process.env.NODE_ENV === "production",
  secrets: getSessionSecret(),
});

export function createGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function readGuestToken(request: Request): Promise<string | null> {
  const value = await guestTokenCookie.parse(request.headers.get("Cookie"));
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function serializeGuestTokenCookie(token: string): Promise<string> {
  return guestTokenCookie.serialize(token);
}

export async function destroyGuestTokenCookie(): Promise<string> {
  return guestTokenCookie.serialize("", { maxAge: 0 });
}

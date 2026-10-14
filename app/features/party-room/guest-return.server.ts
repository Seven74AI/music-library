/**
 * Send the joining browser back into its open guest room.
 * The seat is resolved from the `en_room_guest` cookie alone.
 */

import { redirect } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { buildRoomJoinPath } from "./codes.ts";
import { ROOM_STATUS } from "./constants.ts";
import { hashGuestToken, readGuestToken } from "./guest-token.server.ts";

export async function findOpenGuestSeatFromCookie(
  request: Request,
): Promise<{ roomCode: string } | null> {
  const token = await readGuestToken(request);
  if (!token) return null;

  const seat = await prisma.roomParticipant.findFirst({
    where: {
      guestTokenHash: hashGuestToken(token),
      leftAt: null,
      room: { status: ROOM_STATUS.open },
    },
    orderBy: { lastSeenAt: "desc" },
    select: { room: { select: { code: true } } },
  });

  if (!seat) return null;
  return { roomCode: seat.room.code };
}

/**
 * Logged-out document GET requests re-enter the open guest room.
 * Call only when the request has no signed-in user.
 * Room URLs, API routes, resource routes, and single-fetch data requests stay put.
 */
export async function maybeRedirectLoggedOutGuestToOpenRoom(request: Request): Promise<void> {
  if (request.method !== "GET") return;
  if (!isDocumentRequest(request)) return;

  const pathname = new URL(request.url).pathname;
  if (isRoomCodePath(pathname) || isApiOrResourcePath(pathname)) return;

  const seat = await findOpenGuestSeatFromCookie(request);
  if (!seat) return;

  throw redirect(buildRoomJoinPath(seat.roomCode));
}

/** Single-fetch data requests use a `.data` pathname (`/_.data`, `/about.data`). */
function isDocumentRequest(request: Request): boolean {
  return !new URL(request.url).pathname.endsWith(".data");
}

/** `/rooms/:code` and nested room paths such as `/rooms/:code/search`. */
function isRoomCodePath(pathname: string): boolean {
  return /^\/rooms\/[^/]+(?:\/|$)/.test(pathname);
}

function isApiOrResourcePath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/resources" ||
    pathname.startsWith("/resources/")
  );
}

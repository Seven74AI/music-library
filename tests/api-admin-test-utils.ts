import { parseString } from "set-cookie-parser";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "./db-utils.ts";

/**
 * Create a user (optionally with a role), a session, and return an auth cookie
 * plus the user id. Shared by the admin API test files, which previously each
 * re-implemented near-identical `createCookie`/`createAdminCookie` helpers.
 */
export async function createSessionCookie(role?: "admin"): Promise<{
  cookie: string;
  userId: string;
}> {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: role
        ? {
            connectOrCreate: {
              where: { name: role },
              create: { name: role, description: role },
            },
          }
        : undefined,
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: { expirationDate: getSessionExpirationDate(), userId: user.id },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const parsedCookie = parseString(await authSessionStorage.commitSession(authSession))!;
  return { cookie: `${parsedCookie.name}=${parsedCookie.value}`, userId: user.id };
}

/**
 * Upsert the `local` upload service. Shared by admin API tests.
 */
export function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

/**
 * Extract the `data` payload from a react-router loader/action result (which is
 * a `Response` with a `.data` property), or return the value as-is if it already
 * looks like the payload. Shared by admin API tests.
 */
export function unwrap<T>(result: unknown): T {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: T }).data;
  }
  return result as T;
}

/**
 * Extract the HTTP status from a thrown error (a `Response` or a react-router
 * `data(...)` result whose `init.status` carries the code). Shared by admin API
 * tests that assert deny-by-default (403) and not-found (404) paths.
 */
export async function readThrownStatus(error: unknown): Promise<number | undefined> {
  if (error instanceof Response) return error.status;
  if (typeof error === "object" && error !== null && "init" in error) {
    const init = (error as { init?: { status?: number } }).init;
    return init?.status;
  }
  return undefined;
}

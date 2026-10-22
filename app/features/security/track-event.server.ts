import { prisma } from "#app/utils/db.server.ts";
import { SECURITY_EVENT_TYPES, type SecurityEventType } from "./event-types.ts";
import { hashRequestIp } from "./hash-ip.server.ts";

export { SECURITY_EVENT_TYPES, type SecurityEventType };

/** Account, role, and credential audit rows are kept forever. */
export const PERPETUAL_EVENT_TYPES = new Set<string>([
  SECURITY_EVENT_TYPES.accountCreated,
  SECURITY_EVENT_TYPES.accountDisabled,
  SECURITY_EVENT_TYPES.accountEnabled,
  SECURITY_EVENT_TYPES.accountDeleted,
  SECURITY_EVENT_TYPES.passwordChanged,
  SECURITY_EVENT_TYPES.passwordReset,
  SECURITY_EVENT_TYPES.roleChanged,
]);

export const ACCOUNT_CHANGE_EVENT_TYPES = [
  SECURITY_EVENT_TYPES.accountCreated,
  SECURITY_EVENT_TYPES.accountDisabled,
  SECURITY_EVENT_TYPES.accountEnabled,
  SECURITY_EVENT_TYPES.accountDeleted,
  SECURITY_EVENT_TYPES.passwordChanged,
  SECURITY_EVENT_TYPES.passwordReset,
  SECURITY_EVENT_TYPES.roleChanged,
] as const;

export const SECURITY_EVENT_RETENTION_DAYS = 90;

const BLOCKED_METADATA_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "confirmnewpassword",
  "confirmpassword",
  "token",
  "tokens",
  "access_token",
  "refresh_token",
  "ip",
  "ipaddress",
  "authorization",
]);

export function parseSecurityMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_METADATA_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") {
      clean[key] = value.slice(0, 500);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      clean[key] = value;
    }
  }
  return clean;
}

export async function recordSecurityEvent(input: {
  eventType: string;
  request?: Request;
  ipHash?: string | null;
  userId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
  perpetual?: boolean;
}): Promise<void> {
  try {
    const ipHash =
      input.ipHash !== undefined
        ? input.ipHash
        : input.request
          ? hashRequestIp(input.request)
          : null;
    const clean = input.metadata ? sanitizeMetadata(input.metadata) : null;
    const metadata = clean && Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
    const perpetual = input.perpetual ?? PERPETUAL_EVENT_TYPES.has(input.eventType);

    await prisma.securityEvent.create({
      data: {
        eventType: input.eventType,
        ipHash,
        userId: input.userId ?? null,
        targetUserId: input.targetUserId ?? null,
        metadata,
        perpetual,
      },
    });
  } catch (error) {
    console.error("Failed to record security event", error);
  }
}

export async function recordLoginFailure({
  request,
  username,
  userId,
  reason,
}: {
  request: Request;
  username?: string | null;
  userId?: string | null;
  reason?: string;
}): Promise<void> {
  await recordSecurityEvent({
    request,
    eventType: SECURITY_EVENT_TYPES.loginFailed,
    userId: userId ?? null,
    perpetual: false,
    metadata: {
      ...(username ? { username } : {}),
      ...(reason ? { reason } : {}),
    },
  });
}

export async function recordLoginSuccess({
  request,
  userId,
  username,
  sessionId,
  method,
}: {
  request: Request;
  userId: string;
  username?: string | null;
  sessionId: string;
  method?: string;
}): Promise<void> {
  const device = request.headers.get("user-agent")?.slice(0, 180) ?? null;
  await recordSecurityEvent({
    request,
    eventType: SECURITY_EVENT_TYPES.loginSuccess,
    userId,
    perpetual: false,
    metadata: {
      ...(username ? { username } : {}),
      sessionId,
      ...(device ? { device } : {}),
      ...(method ? { method } : {}),
    },
  });
}

/**
 * Password login outcome. Looks up the account on failure so a known username
 * keeps `userId`, while an unknown username stays null and is stored only in
 * metadata.
 */
export async function recordPasswordLoginResult({
  request,
  username,
  status,
  userId,
  sessionId,
}: {
  request: Request;
  username: string;
  status: "success" | "invalid" | "disabled";
  userId?: string | null;
  sessionId?: string | null;
}): Promise<void> {
  if (status === "success" && userId && sessionId) {
    await recordLoginSuccess({
      request,
      userId,
      username,
      sessionId,
      method: "password",
    });
    return;
  }

  const existing = userId
    ? { id: userId }
    : await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });

  await recordLoginFailure({
    request,
    username,
    userId: existing?.id ?? null,
    reason: status === "disabled" ? "disabled" : "invalid",
  });
}

/**
 * Deletes non-perpetual events older than 90 days. Perpetual audit rows stay.
 * `createdAt` and `perpetual` are indexed.
 */
export async function deleteExpiredSecurityEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SECURITY_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.securityEvent.deleteMany({
    where: {
      perpetual: false,
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

import { prisma } from "#app/utils/db.server.ts";
import {
  ACCOUNT_CHANGE_EVENT_TYPES,
  metaString,
  parseSecurityMetadata,
  SECURITY_EVENT_TYPES,
} from "./track-event.server.ts";

export const SECURITY_THRESHOLDS = {
  failedLoginsPerIpPerHour: 10,
  failedLoginsPerUserPer5Min: 5,
  successAfterFailures: 5,
  /** Badge on the admin overview when failed logins in 24h reach this count. */
  failedLogins24hBadge: 10,
} as const;

export const SECURITY_WINDOWS = {
  ipBurstMs: 60 * 60 * 1000,
  userBurstMs: 5 * 60 * 1000,
  reportMs: 24 * 60 * 60 * 1000,
  successLookbackMs: 24 * 60 * 60 * 1000,
  successListMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export function isFailedLoginBadgeActive(failedLogins24h: number): boolean {
  return failedLogins24h >= SECURITY_THRESHOLDS.failedLogins24hBadge;
}

export type SecurityAlert = {
  severity: "critical" | "warning";
  kind: "ip_burst" | "user_burst" | "success_after_failures";
  message: string;
  ipHash: string | null;
  username: string | null;
  userId: string | null;
  count: number;
};

type TimedEvent = { userId: string | null; createdAt: Date };

function countFailuresBefore({
  userId,
  successAt,
  failures,
  successes,
  lookbackMs,
}: {
  userId: string;
  successAt: Date;
  failures: TimedEvent[];
  successes: TimedEvent[];
  lookbackMs: number;
}): number {
  let windowStart = new Date(successAt.getTime() - lookbackMs);
  for (const success of successes) {
    if (success.userId !== userId) continue;
    if (success.createdAt < successAt && success.createdAt > windowStart) {
      windowStart = success.createdAt;
    }
  }
  let count = 0;
  for (const failure of failures) {
    if (failure.userId !== userId) continue;
    if (failure.createdAt > windowStart && failure.createdAt < successAt) count += 1;
  }
  return count;
}

export async function countFailedLoginsSince(since: Date): Promise<number> {
  return prisma.securityEvent.count({
    where: {
      eventType: SECURITY_EVENT_TYPES.loginFailed,
      createdAt: { gte: since },
    },
  });
}

export async function getSecurityAlerts(now = new Date()): Promise<SecurityAlert[]> {
  const hourAgo = new Date(now.getTime() - SECURITY_WINDOWS.ipBurstMs);
  const fiveMinAgo = new Date(now.getTime() - SECURITY_WINDOWS.userBurstMs);
  const dayAgo = new Date(now.getTime() - SECURITY_WINDOWS.reportMs);

  const [hourFails, recentSuccesses] = await Promise.all([
    prisma.securityEvent.findMany({
      where: {
        eventType: SECURITY_EVENT_TYPES.loginFailed,
        createdAt: { gte: hourAgo },
      },
      select: { ipHash: true, userId: true, metadata: true, createdAt: true },
    }),
    prisma.securityEvent.findMany({
      where: {
        eventType: SECURITY_EVENT_TYPES.loginSuccess,
        createdAt: { gte: dayAgo },
      },
      select: { userId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const alerts: SecurityAlert[] = [];

  const byIp = new Map<string, number>();
  for (const event of hourFails) {
    if (!event.ipHash) continue;
    byIp.set(event.ipHash, (byIp.get(event.ipHash) ?? 0) + 1);
  }
  for (const [ipHash, count] of byIp) {
    if (count < SECURITY_THRESHOLDS.failedLoginsPerIpPerHour) continue;
    alerts.push({
      severity: "critical",
      kind: "ip_burst",
      ipHash,
      username: null,
      userId: null,
      count,
      message: `${count} failed logins from IP hash ${ipHash} in the last hour`,
    });
  }

  const byUser = new Map<
    string,
    { count: number; username: string | null; userId: string | null }
  >();
  for (const event of hourFails) {
    if (event.createdAt < fiveMinAgo) continue;
    const username = metaString(parseSecurityMetadata(event.metadata), "username");
    const key = event.userId ?? (username ? `name:${username}` : null);
    if (!key) continue;
    const current = byUser.get(key) ?? { count: 0, username, userId: event.userId };
    current.count += 1;
    if (!current.username && username) current.username = username;
    byUser.set(key, current);
  }
  for (const group of byUser.values()) {
    if (group.count < SECURITY_THRESHOLDS.failedLoginsPerUserPer5Min) continue;
    const label = group.username ?? group.userId ?? "unknown";
    alerts.push({
      severity: "warning",
      kind: "user_burst",
      ipHash: null,
      username: group.username,
      userId: group.userId,
      count: group.count,
      message: `User '${label}' had ${group.count} failed logins in the last 5 minutes`,
    });
  }

  const successUserIds = [
    ...new Set(
      recentSuccesses.map((event) => event.userId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (successUserIds.length > 0) {
    const lookbackStart = new Date(
      Math.min(...recentSuccesses.map((event) => event.createdAt.getTime())) -
        SECURITY_WINDOWS.successLookbackMs,
    );
    const [failures, successes] = await Promise.all([
      prisma.securityEvent.findMany({
        where: {
          eventType: SECURITY_EVENT_TYPES.loginFailed,
          userId: { in: successUserIds },
          createdAt: { gte: lookbackStart, lte: now },
        },
        select: { userId: true, createdAt: true },
      }),
      prisma.securityEvent.findMany({
        where: {
          eventType: SECURITY_EVENT_TYPES.loginSuccess,
          userId: { in: successUserIds },
          createdAt: { gte: lookbackStart, lte: now },
        },
        select: { userId: true, createdAt: true },
      }),
    ]);

    const flagged = new Set<string>();
    for (const success of recentSuccesses) {
      if (!success.userId || flagged.has(success.userId)) continue;
      const count = countFailuresBefore({
        userId: success.userId,
        successAt: success.createdAt,
        failures,
        successes,
        lookbackMs: SECURITY_WINDOWS.successLookbackMs,
      });
      if (count < SECURITY_THRESHOLDS.successAfterFailures) continue;
      flagged.add(success.userId);
      const username = metaString(parseSecurityMetadata(success.metadata), "username");
      alerts.push({
        severity: "warning",
        kind: "success_after_failures",
        ipHash: null,
        username,
        userId: success.userId,
        count,
        message: `User '${username ?? success.userId}' had ${count} failed logins then a successful login`,
      });
    }
  }

  return alerts;
}

export async function getFailedLoginReport(now = new Date()) {
  const since = new Date(now.getTime() - SECURITY_WINDOWS.reportMs);
  const events = await prisma.securityEvent.findMany({
    where: {
      eventType: SECURITY_EVENT_TYPES.loginFailed,
      createdAt: { gte: since },
    },
    select: { ipHash: true, userId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  type Group = {
    username: string;
    ipHash: string | null;
    count: number;
    lastAttempt: Date;
    userId: string | null;
  };
  const groups = new Map<string, Group>();
  const byUser = new Map<string, { username: string; count: number }>();
  const byIp = new Map<string, number>();

  for (const event of events) {
    const username = metaString(parseSecurityMetadata(event.metadata), "username") ?? "(unknown)";
    const key = `${username}\0${event.ipHash ?? ""}`;
    const group = groups.get(key) ?? {
      username,
      ipHash: event.ipHash,
      count: 0,
      lastAttempt: event.createdAt,
      userId: event.userId,
    };
    group.count += 1;
    if (event.createdAt > group.lastAttempt) group.lastAttempt = event.createdAt;
    if (!group.userId && event.userId) group.userId = event.userId;
    groups.set(key, group);

    const targeted = byUser.get(username) ?? { username, count: 0 };
    targeted.count += 1;
    byUser.set(username, targeted);

    if (event.ipHash) byIp.set(event.ipHash, (byIp.get(event.ipHash) ?? 0) + 1);
  }

  return {
    groups: [...groups.values()]
      .sort((a, b) => b.count - a.count || b.lastAttempt.getTime() - a.lastAttempt.getTime())
      .map((group) => ({
        username: group.username,
        ipHash: group.ipHash,
        count: group.count,
        lastAttempt: group.lastAttempt.toISOString(),
        userId: group.userId,
      })),
    mostTargeted: [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    mostActiveIps: [...byIp.entries()]
      .map(([ipHash, count]) => ({ ipHash, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

export async function getSuccessfulLogins(now = new Date()) {
  const since = new Date(now.getTime() - SECURITY_WINDOWS.successListMs);
  const successes = await prisma.securityEvent.findMany({
    where: {
      eventType: SECURITY_EVENT_TYPES.loginSuccess,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      ipHash: true,
      metadata: true,
      createdAt: true,
      user: { select: { username: true } },
    },
  });
  if (successes.length === 0) return [];

  const oldest = successes[successes.length - 1]!.createdAt;
  const lookback = new Date(oldest.getTime() - SECURITY_WINDOWS.successLookbackMs);
  const userIds = [
    ...new Set(successes.map((event) => event.userId).filter((id): id is string => Boolean(id))),
  ];
  const [failures, earlierSuccesses] = await Promise.all([
    userIds.length
      ? prisma.securityEvent.findMany({
          where: {
            eventType: SECURITY_EVENT_TYPES.loginFailed,
            userId: { in: userIds },
            createdAt: { gte: lookback },
          },
          select: { userId: true, createdAt: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.securityEvent.findMany({
          where: {
            eventType: SECURITY_EVENT_TYPES.loginSuccess,
            userId: { in: userIds },
            createdAt: { gte: lookback },
          },
          select: { userId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  return successes.map((success) => {
    const meta = parseSecurityMetadata(success.metadata);
    const failureCount = success.userId
      ? countFailuresBefore({
          userId: success.userId,
          successAt: success.createdAt,
          failures,
          successes: earlierSuccesses,
          lookbackMs: SECURITY_WINDOWS.successLookbackMs,
        })
      : 0;
    return {
      id: success.id,
      userId: success.userId,
      username: success.user?.username ?? metaString(meta, "username"),
      ipHash: success.ipHash,
      device: metaString(meta, "device"),
      createdAt: success.createdAt.toISOString(),
      failureCount,
      afterFailures: failureCount >= SECURITY_THRESHOLDS.successAfterFailures,
    };
  });
}

function describeAccountChange(
  eventType: string,
  actor: string | null,
  target: string | null,
  meta: Record<string, unknown>,
): string {
  const who = actor ?? "system";
  const whom = target ?? "account";
  switch (eventType) {
    case SECURITY_EVENT_TYPES.accountDisabled:
      return `${who} disabled ${whom}`;
    case SECURITY_EVENT_TYPES.accountEnabled:
      return `${who} enabled ${whom}`;
    case SECURITY_EVENT_TYPES.accountCreated:
      return `Account created for ${target ?? who}`;
    case SECURITY_EVENT_TYPES.accountDeleted:
      return `${who} deleted ${whom}`;
    case SECURITY_EVENT_TYPES.passwordChanged:
      return `${who} changed the password for ${whom}`;
    case SECURITY_EVENT_TYPES.passwordReset:
      return `Password reset for ${whom}`;
    case SECURITY_EVENT_TYPES.roleChanged: {
      const role = metaString(meta, "role") ?? "role";
      const action = metaString(meta, "action");
      if (action === "promote") return `${who} promoted ${whom} to ${role}`;
      if (action === "demote") return `${who} demoted ${whom} from ${role}`;
      return `${who} changed ${role} for ${whom}`;
    }
    default:
      return `${who} recorded ${eventType} for ${whom}`;
  }
}

export async function getAccountChanges() {
  const events = await prisma.securityEvent.findMany({
    where: {
      eventType: { in: [...ACCOUNT_CHANGE_EVENT_TYPES] },
      perpetual: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      eventType: true,
      createdAt: true,
      metadata: true,
      user: { select: { username: true } },
      targetUser: { select: { username: true } },
    },
  });

  return events.map((event) => {
    const meta = parseSecurityMetadata(event.metadata);
    const actorUsername = event.user?.username ?? null;
    const targetUsername = event.targetUser?.username ?? metaString(meta, "username");
    return {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString(),
      actorUsername,
      targetUsername,
      summary: describeAccountChange(event.eventType, actorUsername, targetUsername, meta),
    };
  });
}

function parseDayStart(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDayEnd(value: string): Date | null {
  const start = parseDayStart(value);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

const KNOWN_EVENT_TYPES = new Set<string>(Object.values(SECURITY_EVENT_TYPES));

export async function getSecurityTimeline(filters: {
  eventType?: string | null;
  username?: string | null;
  from?: string | null;
  to?: string | null;
}) {
  const eventType =
    filters.eventType && KNOWN_EVENT_TYPES.has(filters.eventType) ? filters.eventType : undefined;
  const username = filters.username?.trim().toLowerCase() ?? "";
  const from = filters.from ? parseDayStart(filters.from) : null;
  const to = filters.to ? parseDayEnd(filters.to) : null;
  const createdAt =
    from || to
      ? {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        }
      : undefined;

  const events = await prisma.securityEvent.findMany({
    where: {
      ...(eventType ? { eventType } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(username
        ? {
            OR: [
              { user: { username: { contains: username } } },
              { targetUser: { username: { contains: username } } },
              { metadata: { contains: username } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      eventType: true,
      ipHash: true,
      createdAt: true,
      metadata: true,
      perpetual: true,
      user: { select: { username: true } },
      targetUser: { select: { username: true } },
    },
  });

  return {
    events: events.map((event) => {
      const meta = parseSecurityMetadata(event.metadata);
      return {
        id: event.id,
        eventType: event.eventType,
        ipHash: event.ipHash,
        perpetual: event.perpetual,
        createdAt: event.createdAt.toISOString(),
        username: event.user?.username ?? metaString(meta, "username"),
        targetUsername: event.targetUser?.username ?? null,
      };
    }),
    eventTypes: [...KNOWN_EVENT_TYPES],
  };
}

import { expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  getFailedLoginReport,
  getSecurityAlerts,
  getSecurityTimeline,
  getSuccessfulLogins,
  isFailedLoginBadgeActive,
  SECURITY_THRESHOLDS,
} from "./suspicious-activity.server.ts";

test("failed-login badge turns on at the 24h threshold", () => {
  expect(isFailedLoginBadgeActive(SECURITY_THRESHOLDS.failedLogins24hBadge - 1)).toBe(false);
  expect(isFailedLoginBadgeActive(SECURITY_THRESHOLDS.failedLogins24hBadge)).toBe(true);
});

test("alerts at 10 fails per IP hash per hour and not at 9", async () => {
  const ipHash = `ip${Date.now().toString(16)}`.slice(0, 16);
  await prisma.securityEvent.createMany({
    data: Array.from({ length: 9 }, () => ({
      eventType: "login_failed",
      ipHash,
      metadata: JSON.stringify({ username: `burst_${ipHash}` }),
    })),
  });

  let alerts = await getSecurityAlerts();
  expect(alerts.some((alert) => alert.kind === "ip_burst" && alert.ipHash === ipHash)).toBe(false);

  await prisma.securityEvent.create({
    data: {
      eventType: "login_failed",
      ipHash,
      metadata: JSON.stringify({ username: `burst_${ipHash}` }),
    },
  });
  alerts = await getSecurityAlerts();
  const match = alerts.find((alert) => alert.kind === "ip_burst" && alert.ipHash === ipHash);
  expect(match?.severity).toBe("critical");
  expect(match?.count).toBeGreaterThanOrEqual(10);
});

test("alerts at 5 fails per user in 5 minutes and not at 4", async () => {
  const user = await prisma.user.create({ data: createUser() });
  const base = {
    eventType: "login_failed",
    userId: user.id,
    ipHash: `u${user.id}`.slice(0, 16),
    metadata: JSON.stringify({ username: user.username }),
  };
  await prisma.securityEvent.createMany({
    data: Array.from({ length: 4 }, () => base),
  });

  let alerts = await getSecurityAlerts();
  expect(alerts.some((alert) => alert.kind === "user_burst" && alert.userId === user.id)).toBe(
    false,
  );

  await prisma.securityEvent.create({ data: base });
  alerts = await getSecurityAlerts();
  expect(alerts.some((alert) => alert.kind === "user_burst" && alert.userId === user.id)).toBe(
    true,
  );
});

test("flags a successful login that follows 5 failures", async () => {
  const user = await prisma.user.create({ data: createUser() });
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const ipHash = `s${user.id}`.slice(0, 16);
  await prisma.securityEvent.createMany({
    data: Array.from({ length: 5 }, () => ({
      eventType: "login_failed",
      userId: user.id,
      ipHash,
      metadata: JSON.stringify({ username: user.username }),
      createdAt: tenMinutesAgo,
    })),
  });
  await prisma.securityEvent.create({
    data: {
      eventType: "login_success",
      userId: user.id,
      ipHash,
      metadata: JSON.stringify({ username: user.username }),
    },
  });

  const alerts = await getSecurityAlerts();
  expect(
    alerts.some((alert) => alert.kind === "success_after_failures" && alert.userId === user.id),
  ).toBe(true);
  expect(alerts.some((alert) => alert.kind === "user_burst" && alert.userId === user.id)).toBe(
    false,
  );

  const rows = await getSuccessfulLogins();
  const row = rows.find((entry) => entry.userId === user.id);
  expect(row?.afterFailures).toBe(true);
  expect(row?.failureCount).toBeGreaterThanOrEqual(5);
});

test("failed logins group by username and ip hash", async () => {
  const username = `grouped_${Date.now().toString(36)}`;
  const ipHash = `g${Date.now().toString(16)}`.slice(0, 16);
  await prisma.securityEvent.createMany({
    data: Array.from({ length: 3 }, () => ({
      eventType: "login_failed",
      ipHash,
      metadata: JSON.stringify({ username }),
    })),
  });

  const report = await getFailedLoginReport();
  const group = report.groups.find((row) => row.username === username && row.ipHash === ipHash);
  expect(group?.count).toBe(3);
  expect(report.mostTargeted.some((row) => row.username === username)).toBe(true);
  expect(report.mostActiveIps.some((row) => row.ipHash === ipHash)).toBe(true);
});

test("timeline filters by event type, username, and date range", async () => {
  const user = await prisma.user.create({ data: createUser() });
  const other = await prisma.user.create({ data: createUser() });
  const matched = await prisma.securityEvent.create({
    data: {
      eventType: "login_failed",
      userId: user.id,
      metadata: JSON.stringify({ username: user.username }),
      createdAt: new Date("2026-03-02T12:00:00.000Z"),
    },
  });
  const otherType = await prisma.securityEvent.create({
    data: {
      eventType: "login_success",
      userId: user.id,
      metadata: JSON.stringify({ username: user.username }),
      createdAt: new Date("2026-03-02T12:00:00.000Z"),
    },
  });
  const otherUser = await prisma.securityEvent.create({
    data: {
      eventType: "login_failed",
      userId: other.id,
      metadata: JSON.stringify({ username: other.username }),
      createdAt: new Date("2026-03-02T12:00:00.000Z"),
    },
  });
  const outside = await prisma.securityEvent.create({
    data: {
      eventType: "login_failed",
      userId: user.id,
      metadata: JSON.stringify({ username: user.username }),
      createdAt: new Date("2025-01-01T12:00:00.000Z"),
    },
  });

  const result = await getSecurityTimeline({
    eventType: "login_failed",
    username: user.username,
    from: "2026-03-01",
    to: "2026-03-03",
  });
  const ids = result.events.map((event) => event.id);
  expect(ids).toContain(matched.id);
  expect(ids).not.toContain(otherType.id);
  expect(ids).not.toContain(otherUser.id);
  expect(ids).not.toContain(outside.id);
});

import { expect, test } from "vitest";
import { action as loginAction } from "#app/routes/_auth+/login.tsx";
import { prisma } from "#app/utils/db.server.ts";
import { createPassword, createUser } from "#tests/db-utils.ts";
import { disableUser } from "#app/features/usage-analytics/admin-users.server.ts";
import { hashIP, hashRequestIp } from "./hash-ip.server.ts";
import {
  deleteExpiredSecurityEvents,
  SECURITY_EVENT_RETENTION_DAYS,
} from "./track-event.server.ts";

const IP = "203.0.113.44";

function loginRequest(username: string, password: string) {
  const form = new FormData();
  form.set("username", username);
  form.set("password", password);
  const request = new Request("http://localhost/login", {
    method: "POST",
    body: form,
    headers: { "fly-client-ip": IP, "user-agent": "TestBrowser/1.0" },
  });
  return request;
}

async function submitLogin(username: string, password: string) {
  const request = loginRequest(username, password);
  return loginAction({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/login",
  });
}

test("failed login for an unknown username stores the attempt without a user id or raw IP", async () => {
  const username = `missing_${Date.now().toString(36)}`;
  await submitLogin(username, "not-the-password");

  const event = await prisma.securityEvent.findFirst({
    where: { eventType: "login_failed", metadata: { contains: username } },
    orderBy: { createdAt: "desc" },
  });
  expect(event).not.toBeNull();
  expect(event?.userId).toBeNull();
  expect(event?.perpetual).toBe(false);
  expect(event?.ipHash).toBe(hashIP(IP, process.env.IP_HASH_SALT ?? "dev-ip-hash-salt-change-me"));
  expect(JSON.stringify(event)).not.toContain(IP);
  const metadata = JSON.parse(event?.metadata ?? "{}") as { username?: string };
  expect(metadata.username).toBe(username);
});

test("failed then successful password login records both events for the same IP hash", async () => {
  const password = "s3cret1";
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      password: { create: createPassword(password) },
    },
  });

  await submitLogin(user.username, "wrong-password");
  const success = await submitLogin(user.username, password);
  expect(success).toBeInstanceOf(Response);

  const events = await prisma.securityEvent.findMany({
    where: {
      OR: [{ userId: user.id }, { metadata: { contains: user.username } }],
      eventType: { in: ["login_failed", "login_success"] },
    },
    orderBy: { createdAt: "asc" },
  });
  const failed = events.filter((event) => event.eventType === "login_failed");
  const succeeded = events.filter((event) => event.eventType === "login_success");
  expect(failed.length).toBeGreaterThanOrEqual(1);
  expect(failed[0]?.userId).toBe(user.id);
  expect(succeeded.length).toBeGreaterThanOrEqual(1);
  expect(succeeded.at(-1)?.userId).toBe(user.id);
  expect(succeeded.at(-1)?.perpetual).toBe(false);
  expect(failed[0]?.ipHash).toBe(succeeded.at(-1)?.ipHash);
  expect(failed[0]?.ipHash).toBe(hashRequestIp(loginRequest(user.username, password)));
  expect(JSON.stringify(succeeded.at(-1)?.metadata)).toContain("sessionId");
  expect(JSON.stringify(events)).not.toContain(IP);
  expect(JSON.stringify(events)).not.toContain(password);
});

test("retention deletes old non-perpetual events and keeps perpetual rows", async () => {
  const user = await prisma.user.create({ data: createUser() });
  const old = new Date(Date.now() - (SECURITY_EVENT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
  const expired = await prisma.securityEvent.create({
    data: {
      eventType: "login_failed",
      userId: user.id,
      perpetual: false,
      createdAt: old,
      metadata: JSON.stringify({ username: user.username }),
    },
  });
  const kept = await prisma.securityEvent.create({
    data: {
      eventType: "account_disabled",
      userId: user.id,
      targetUserId: user.id,
      perpetual: true,
      createdAt: old,
      metadata: JSON.stringify({ username: user.username }),
    },
  });
  const recent = await prisma.securityEvent.create({
    data: {
      eventType: "login_success",
      userId: user.id,
      perpetual: false,
      metadata: JSON.stringify({ username: user.username }),
    },
  });

  await deleteExpiredSecurityEvents();

  expect(await prisma.securityEvent.findUnique({ where: { id: expired.id } })).toBeNull();
  expect(await prisma.securityEvent.findUnique({ where: { id: kept.id } })).not.toBeNull();
  expect(await prisma.securityEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
});

test("disableUser records a perpetual account_disabled event naming the actor", async () => {
  const actor = await prisma.user.create({ data: createUser() });
  const target = await prisma.user.create({ data: createUser() });

  await disableUser(target.id, actor.id);

  const event = await prisma.securityEvent.findFirst({
    where: { eventType: "account_disabled", targetUserId: target.id },
    orderBy: { createdAt: "desc" },
  });
  expect(event?.userId).toBe(actor.id);
  expect(event?.perpetual).toBe(true);
  expect(event?.metadata).toContain(target.username);
});

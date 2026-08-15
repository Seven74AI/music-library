import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  deleteUserAsAdmin,
  demoteFromAdmin,
  disableUser,
  enableUser,
  promoteToAdmin,
} from "./admin-users.server.ts";

describe("admin user moderation", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.upsert({
      where: { name: "admin" },
      update: {},
      create: { name: "admin", description: "Admin" },
    });
    await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user", description: "User" },
    });
  });

  test("disableUser sets disabledAt and clears sessions", async () => {
    const user = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: { name: "user" } },
        sessions: {
          create: { expirationDate: new Date(Date.now() + 86_400_000) },
        },
      },
    });

    await disableUser(user.id);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.disabledAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  test("enableUser clears disabledAt", async () => {
    const user = await prisma.user.create({
      data: {
        ...createUser(),
        disabledAt: new Date(),
        roles: { connect: { name: "user" } },
      },
    });

    await enableUser(user.id);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.disabledAt).toBeNull();
  });

  test("promoteToAdmin connects admin role", async () => {
    const user = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: { name: "user" } },
      },
    });

    await promoteToAdmin(user.id);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roles: true },
    });
    expect(updated.roles.map((r) => r.name).sort()).toEqual(["admin", "user"]);
  });

  test("demoteFromAdmin blocks self-demotion and last admin", async () => {
    const admin = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });

    const selfResult = await demoteFromAdmin({
      targetUserId: admin.id,
      actorUserId: admin.id,
    });
    expect(selfResult).toEqual({
      ok: false,
      reason: "forbidden",
      error: "You cannot demote yourself",
    });

    const lastResult = await demoteFromAdmin({
      targetUserId: admin.id,
      actorUserId: "someone-else",
    });
    expect(lastResult).toEqual({
      ok: false,
      reason: "forbidden",
      error: "Cannot demote the last admin",
    });
  });

  test("demoteFromAdmin reports a non-admin target rather than blaming the last admin", async () => {
    const admin = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });
    const regular = await prisma.user.create({
      data: { ...createUser(), roles: { connect: { name: "user" } } },
    });

    const result = await demoteFromAdmin({
      targetUserId: regular.id,
      actorUserId: admin.id,
    });

    expect(result).toEqual({
      ok: false,
      reason: "forbidden",
      error: "This user is not an admin",
    });
  });

  test.each([
    ["disableUser", (id: string) => disableUser(id)],
    ["enableUser", (id: string) => enableUser(id)],
    ["promoteToAdmin", (id: string) => promoteToAdmin(id)],
  ])("%s reports a missing user instead of throwing", async (_label, run) => {
    await expect(run("no-such-user")).resolves.toEqual({
      ok: false,
      reason: "not-found",
      error: "User not found",
    });
  });

  test("demoteFromAdmin and deleteUserAsAdmin report a missing target", async () => {
    const admin = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });

    const missing = { ok: false, reason: "not-found", error: "User not found" };
    await expect(demoteFromAdmin({ targetUserId: "nope", actorUserId: admin.id })).resolves.toEqual(
      missing,
    );
    await expect(
      deleteUserAsAdmin({ targetUserId: "nope", actorUserId: admin.id }),
    ).resolves.toEqual(missing);
  });

  test("demoteFromAdmin succeeds when another admin exists", async () => {
    const adminA = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });
    const adminB = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });

    const result = await demoteFromAdmin({
      targetUserId: adminB.id,
      actorUserId: adminA.id,
    });
    expect(result).toEqual({ ok: true });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: adminB.id },
      include: { roles: true },
    });
    expect(updated.roles.map((r) => r.name)).toEqual(["user"]);
  });

  test("deleteUserAsAdmin blocks self-delete and last admin", async () => {
    const admin = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });

    expect(await deleteUserAsAdmin({ targetUserId: admin.id, actorUserId: admin.id })).toEqual({
      ok: false,
      reason: "forbidden",
      error: "You cannot delete your own account from admin",
    });

    expect(await deleteUserAsAdmin({ targetUserId: admin.id, actorUserId: "other" })).toEqual({
      ok: false,
      reason: "forbidden",
      error: "Cannot delete the last admin",
    });
  });

  test("deleteUserAsAdmin deletes a regular user", async () => {
    const admin = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: [{ name: "admin" }, { name: "user" }] },
      },
    });
    const user = await prisma.user.create({
      data: {
        ...createUser(),
        roles: { connect: { name: "user" } },
      },
    });

    const result = await deleteUserAsAdmin({
      targetUserId: user.id,
      actorUserId: admin.id,
    });
    expect(result).toEqual({ ok: true });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});

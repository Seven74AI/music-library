/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { parseString } from "set-cookie-parser";
import { expect, test, vi } from "vitest";
import { loader as rootLoader } from "#app/root.tsx";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { default as DbBackupRoute, loader, action } from "./db-backup.tsx";

vi.mock("#app/utils/litefs.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/litefs.server.ts")>();
  return {
    ...actual,
    ensurePrimary: vi.fn(async () => undefined),
    getInstanceInfo: vi.fn(async () => ({
      currentIsPrimary: true,
      primaryInstance: "test",
      currentInstance: "test",
    })),
  };
});

vi.mock("#app/features/db-backup/backup.server.ts", () => ({
  runBackup: vi.fn(async () => ({
    ok: true as const,
    dailyKey: "backups/sqlite/daily/2026-09-28.db",
    weeklyKey: "backups/sqlite/weekly/2026-W40.db",
  })),
}));

async function createAdminSession() {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin" },
        },
      },
    },
  });
  const session = await prisma.session.create({
    select: { id: true },
    data: {
      expirationDate: getSessionExpirationDate(),
      userId: user.id,
    },
  });
  const authSession = await authSessionStorage.getSession();
  authSession.set(sessionKey, session.id);
  const setCookieHeader = await authSessionStorage.commitSession(authSession);
  const parsedCookie = parseString(setCookieHeader)!;
  return new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
}

test("db-backup admin page renders status and Backup now", async () => {
  process.env.BACKUP_BUCKET_NAME = "test-backups";
  await prisma.backupState.deleteMany({});
  await prisma.backupState.create({
    data: {
      id: "singleton",
      lastStatus: "success",
      lastSuccessAt: new Date("2026-09-27T03:00:00.000Z"),
      lastObjectKey: "backups/sqlite/daily/2026-09-27.db",
    },
  });

  const cookieHeader = await createAdminSession();
  const App = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: async (args) => {
        args.request.headers.set("cookie", cookieHeader);
        return rootLoader({ ...args, context: args.context });
      },
      HydrateFallback: () => <div>Loading...</div>,
      children: [
        {
          path: "admin/db-backup",
          Component: DbBackupRoute,
          loader: async (args) => {
            args.request.headers.set("cookie", cookieHeader);
            return loader({ ...args, context: args.context });
          },
        },
      ],
    },
  ]);

  render(<App initialEntries={["/admin/db-backup"]} />);

  await screen.findByRole("heading", { level: 1, name: /database backups/i }, { timeout: 5000 });
  expect(screen.getByText(/last success/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /backup now/i })).toBeTruthy();
  expect(screen.getByText(/backups\/sqlite\/daily\/2026-09-27\.db/)).toBeTruthy();
});

test("backup-now action returns uploaded keys", async () => {
  process.env.BACKUP_BUCKET_NAME = "test-backups";
  const cookieHeader = await createAdminSession();
  const formData = new FormData();
  formData.set("intent", "backup-now");
  const request = new Request("http://localhost/admin/db-backup", {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: formData,
  });
  const result = await action({
    request,
    params: {},
    context: {} as never,
  } as never);
  const body =
    result && typeof result === "object" && "data" in result
      ? (result as { data: { ok: boolean; dailyKey?: string } }).data
      : (result as { ok: boolean; dailyKey?: string });
  expect(body.ok).toBe(true);
  expect(body.dailyKey).toBe("backups/sqlite/daily/2026-09-28.db");
});

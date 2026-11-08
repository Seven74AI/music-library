import { parseString } from "set-cookie-parser";
import { beforeEach, expect, test } from "vitest";
import { initUploadProgress } from "#app/features/upload-progress/progress-store.server.ts";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { loader } from "./upload-progress-sse.server.ts";

async function adminCookie() {
  const user = await prisma.user.create({
    select: { id: true },
    data: {
      ...createUser(),
      roles: {
        connectOrCreate: {
          where: { name: "admin" },
          create: { name: "admin", description: "Admin" },
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
  return {
    userId: user.id,
    cookie: `${parsedCookie.name}=${parsedCookie.value}`,
  };
}

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

test("rejects SSE when another admin owns the upload session", async () => {
  const owner = await adminCookie();
  const intruder = await adminCookie();
  const uploadId = `upload-sse-${Date.now()}`;
  await initUploadProgress(uploadId, ["a.mp3"], owner.userId);

  const response = await loader({
    request: new Request(`http://localhost/api/upload-progress/${uploadId}`, {
      headers: { cookie: intruder.cookie },
    }),
    params: { uploadId },
    context: {},
  } as never);

  expect(response).toMatchObject({ init: { status: 403 } });
});

test("allows SSE for the admin who owns the upload session", async () => {
  const owner = await adminCookie();
  const uploadId = `upload-sse-own-${Date.now()}`;
  await initUploadProgress(uploadId, ["a.mp3"], owner.userId);

  const response = await loader({
    request: new Request(`http://localhost/api/upload-progress/${uploadId}`, {
      headers: { cookie: owner.cookie },
    }),
    params: { uploadId },
    context: {},
  } as never);

  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(200);
  expect((response as Response).headers.get("Content-Type")).toBe("text/event-stream");
});

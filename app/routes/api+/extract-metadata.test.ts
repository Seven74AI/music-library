import { readFileSync } from "node:fs";
import { parseString } from "set-cookie-parser";
import { expect, test } from "vitest";
import { getSessionExpirationDate, sessionKey } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action } from "./extract-metadata.tsx";

const tinyMp3 = readFileSync(new URL("../../../tests/fixtures/tiny-tone.mp3", import.meta.url));

async function createAdminCookie() {
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
  const cookie = new URLSearchParams({
    [parsedCookie.name]: parsedCookie.value,
  }).toString();
  return { userId: user.id, cookie };
}

test("one empty file does not reject metadata extraction for the rest of the batch", async () => {
  const { userId, cookie } = await createAdminCookie();
  try {
    const formData = new FormData();
    formData.append("files", new File([tinyMp3], "good.mp3", { type: "audio/mpeg" }));
    formData.append("files", new File([], "empty.mp3", { type: "audio/mpeg" }));

    const response = await action({
      request: new Request("http://localhost/api/extract-metadata", {
        method: "POST",
        headers: { cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(response.init?.status ?? 200).toBe(200);
    const body = response.data;
    if (!body.success || !("files" in body)) {
      throw new Error("expected per-file metadata results");
    }
    expect(body.files).toHaveLength(2);
    expect(body.files[0]?.fileName).toBe("good.mp3");
    expect(body.files[0]?.metadata).not.toBeNull();
    expect(body.files[0]?.error).toBeUndefined();
    expect(body.files[1]?.fileName).toBe("empty.mp3");
    expect(body.files[1]?.metadata).toBeNull();
    expect(body.files[1]?.error).toMatch(/empty/i);
  } finally {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
});

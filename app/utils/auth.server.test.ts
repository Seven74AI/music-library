import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import { createPassword, createUser } from "#tests/db-utils.ts";
import { server } from "#tests/mocks";
import { consoleWarn } from "#tests/setup/setup-test-env.ts";
import {
  checkIsCommonPassword,
  getPasswordHash,
  getPasswordHashParts,
  getSessionExpirationDate,
  login,
  resetUserPassword,
  verifyUserPassword,
} from "./auth.server.ts";
import { prisma } from "./db.server.ts";

test("checkIsCommonPassword returns true when password is found in breach database", async () => {
  const password = "testpassword";
  const [prefix, suffix] = getPasswordHashParts(password);

  server.use(
    http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
      // Include the actual suffix in the response with another realistic suffix
      return new HttpResponse(`1234567890123456789012345678901234A:1\n${suffix}:1234`, {
        status: 200,
      });
    }),
  );

  const result = await checkIsCommonPassword(password);
  expect(result).toBe(true);
});

test("checkIsCommonPassword returns false when password is not found in breach database", async () => {
  const password = "sup3r-dup3r-s3cret";
  const [prefix] = getPasswordHashParts(password);

  server.use(
    http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
      // Response with realistic suffixes that won't match
      return new HttpResponse(
        "1234567890123456789012345678901234A:1\n1234567890123456789012345678901234B:2",
        { status: 200 },
      );
    }),
  );

  const result = await checkIsCommonPassword(password);
  expect(result).toBe(false);
});

// Error cases
test("checkIsCommonPassword returns false when API returns 500", async () => {
  const password = "testpassword";
  const [prefix] = getPasswordHashParts(password);

  server.use(
    http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
      return new HttpResponse(null, { status: 500 });
    }),
  );

  const result = await checkIsCommonPassword(password);
  expect(result).toBe(false);
});

test("checkIsCommonPassword returns false when response has invalid format", async () => {
  consoleWarn.mockImplementation(() => {});
  const password = "testpassword";
  const [prefix] = getPasswordHashParts(password);

  server.use(
    http.get(`https://api.pwnedpasswords.com/range/${prefix}`, () => {
      return HttpResponse.error();
    }),
  );

  const result = await checkIsCommonPassword(password);
  expect(result).toBe(false);
  expect(consoleWarn).toHaveBeenCalledWith(
    "Unknown error during password check",
    expect.any(Error),
  );
});

describe("timeout handling", () => {
  // normally we'd use fake timers for a test like this, but there's an issue
  // with AbortSignal.timeout() and fake timers: https://github.com/sinonjs/fake-timers/issues/418
  // beforeEach(() => vi.useFakeTimers())
  // afterEach(() => vi.useRealTimers())

  test("checkIsCommonPassword times out after 1 second", async () => {
    consoleWarn.mockImplementation(() => {});
    server.use(
      http.get("https://api.pwnedpasswords.com/range/:prefix", async () => {
        const twoSecondDelay = 2000;
        await new Promise((resolve) => setTimeout(resolve, twoSecondDelay));
        // swap to this when we can use fake timers:
        // await vi.advanceTimersByTimeAsync(twoSecondDelay)
        return new HttpResponse(
          "1234567890123456789012345678901234A:1\n1234567890123456789012345678901234B:2",
          { status: 200 },
        );
      }),
    );

    const result = await checkIsCommonPassword("testpassword");
    expect(result).toBe(false);
    expect(consoleWarn).toHaveBeenCalledWith("Password check timed out");
  });
});

test("login accepts a pre-existing password shorter than 12 characters without rewriting the hash", async () => {
  const password = "abcdef";
  const { hash } = createPassword(password);
  const user = await prisma.user.create({
    data: {
      ...createUser(),
      password: { create: { hash } },
    },
  });

  try {
    const result = await login({ username: user.username, password });
    expect(result.status).toBe("success");

    const stored = await prisma.password.findUniqueOrThrow({
      where: { userId: user.id },
      select: { hash: true },
    });
    expect(stored.hash).toBe(hash);
    expect(stored.hash).toMatch(/^\$2[ab]\$10\$/);
  } finally {
    await prisma.usageEvent.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test("getPasswordHash keeps bcrypt cost 10", async () => {
  const hashed = await getPasswordHash("abcdefghijkl");
  expect(hashed).toMatch(/^\$2[ab]\$10\$/);
});

describe("verifyUserPassword", () => {
  test("returns the user id when the password is correct", async () => {
    const password = "correct-horse-battery-staple";
    const { hash } = createPassword(password);
    const user = await prisma.user.create({
      data: { ...createUser(), password: { create: { hash } } },
    });

    try {
      expect(await verifyUserPassword({ username: user.username }, password)).toEqual({
        id: user.id,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("returns null when the password is incorrect", async () => {
    const password = "correct-horse-battery-staple";
    const { hash } = createPassword(password);
    const user = await prisma.user.create({
      data: { ...createUser(), password: { create: { hash } } },
    });

    try {
      expect(await verifyUserPassword({ username: user.username }, "wrong-password")).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("returns null for a non-existent user", async () => {
    expect(await verifyUserPassword({ username: "no-such-user" }, "whatever")).toBeNull();
  });
});

describe("resetUserPassword", () => {
  test("invalidates all existing sessions and updates the password", async () => {
    const oldPassword = "old-password-123";
    const newPassword = "new-password-456";
    const { hash } = createPassword(oldPassword);
    const user = await prisma.user.create({
      data: { ...createUser(), password: { create: { hash } } },
    });

    await prisma.session.create({
      data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    });
    await prisma.session.create({
      data: { userId: user.id, expirationDate: getSessionExpirationDate() },
    });

    try {
      await resetUserPassword({ username: user.username, password: newPassword });

      const sessions = await prisma.session.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(0);

      expect(await verifyUserPassword({ username: user.username }, oldPassword)).toBeNull();
      expect(await verifyUserPassword({ username: user.username }, newPassword)).toEqual({
        id: user.id,
      });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("throws when the user does not exist", async () => {
    await expect(
      resetUserPassword({ username: "no-such-user", password: "whatever-123" }),
    ).rejects.toThrow("User not found");
  });
});

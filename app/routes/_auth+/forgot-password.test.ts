import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action } from "./forgot-password.tsx";
import { getRedirectToUrl } from "./verify.server.ts";

const HONEYPOT_FIELD = "name__confirm";
const createdUserIds: string[] = [];
const emailRecipients: string[] = [];
const verificationTargets: string[] = [];

function emailFixturePath(recipient: string) {
  return path.join(process.cwd(), "tests", "fixtures", "email", `${recipient}.json`);
}

function forgotPasswordRequest(usernameOrEmail: string, honeypotValue?: string) {
  const form = new FormData();
  form.set("usernameOrEmail", usernameOrEmail);
  if (honeypotValue !== undefined) {
    form.set(HONEYPOT_FIELD, honeypotValue);
  }
  return new Request("http://localhost/forgot-password", {
    method: "POST",
    body: form,
  });
}

function callAction(request: Request) {
  return action({
    request,
    params: {},
    context: {} as never,
    url: new URL(request.url),
    pattern: "/forgot-password",
  });
}

function codeLessVerifyUrl(request: Request, target: string) {
  return getRedirectToUrl({
    request,
    type: "reset-password",
    target,
  }).toString();
}

const USERNAME_OR_EMAIL_MESSAGE = "Please enter a username or email";

function validationFieldErrors(result: unknown) {
  const payload = result as {
    data?: { result?: { error?: Record<string, string[] | null | undefined> } };
  };
  return payload.data?.result?.error?.usernameOrEmail ?? [];
}

function successShape(response: Response) {
  const locationHeader = response.headers.get("location");
  const location = new URL(locationHeader ?? "http://invalid.example");
  return {
    status: response.status,
    pathname: location.pathname,
    paramNames: [...location.searchParams.keys()].sort(),
    hasCode: location.searchParams.has("code"),
    toastCookie: response.headers.getSetCookie().some((cookie) => cookie.startsWith("en_toast=")),
  };
}

function trackTarget(target: string) {
  verificationTargets.push(target);
}

async function createAccount() {
  const user = await prisma.user.create({ data: createUser() });
  createdUserIds.push(user.id);
  emailRecipients.push(user.email);
  trackTarget(user.username);
  trackTarget(user.email);
  await fs.rm(emailFixturePath(user.email), { force: true });
  return user;
}

async function verificationCount() {
  return prisma.verification.count();
}

async function resendCallsDuring<T>(run: () => Promise<T>) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    const result = await run();
    const calls = fetchSpy.mock.calls.filter(([input]) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes("api.resend.com/emails");
    });
    return { result, calls };
  } finally {
    fetchSpy.mockRestore();
  }
}

async function readSentEmail(recipient: string) {
  const raw = await fs.readFile(emailFixturePath(recipient), "utf8");
  return JSON.parse(raw) as {
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
  };
}

afterEach(async () => {
  const targets = verificationTargets.splice(0);
  if (targets.length > 0) {
    await prisma.verification.deleteMany({
      where: { target: { in: targets }, type: "reset-password" },
    });
  }
  const userIds = createdUserIds.splice(0);
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await Promise.all(
    emailRecipients
      .splice(0)
      .map((recipient) => fs.rm(emailFixturePath(recipient), { force: true })),
  );
});

describe("forgot password action", () => {
  test("known username sends the reset email and redirects to the code-less verify URL", async () => {
    const user = await createAccount();
    const request = forgotPasswordRequest(user.username);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect(codeLessVerifyUrl(request, user.username));
    expect(successShape(response)).toEqual({
      status: 302,
      pathname: "/verify",
      paramNames: ["target", "type"],
      hasCode: false,
      toastCookie: false,
    });
    expect(await response.clone().text()).not.toContain("No user exists");

    expect(calls).toHaveLength(1);
    const email = await readSentEmail(user.email);
    expect(email.to).toBe(user.email);
    expect(email.subject).toMatch(/password reset/i);
    expect(email.text).toMatch(/verification code/i);
    const code = email.text.match(/code=([A-Z0-9]+)/)?.[1];
    expect(code).toBeTruthy();
    expect(response.headers.get("location")).not.toContain(`code=${code}`);

    expect(await verificationCount()).toBe(before + 1);
    const verification = await prisma.verification.findUnique({
      where: { target_type: { target: user.username, type: "reset-password" } },
    });
    expect(verification).not.toBeNull();
  });

  test("known email sends the reset email and redirects to the code-less verify URL", async () => {
    const user = await createAccount();
    const request = forgotPasswordRequest(user.email);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect(codeLessVerifyUrl(request, user.email));
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("code")).toBeNull();
    expect(calls).toHaveLength(1);
    expect((await readSentEmail(user.email)).to).toBe(user.email);
    expect(await verificationCount()).toBe(before + 1);
  });

  test("unknown username gets the same redirect as a known account and does not email or store a verification", async () => {
    const user = await createAccount();
    const unknownUsername = `no${Date.now().toString(36)}`.slice(0, 20);
    trackTarget(unknownUsername);
    const knownRequest = forgotPasswordRequest(user.username);
    const unknownRequest = forgotPasswordRequest(unknownUsername);
    const before = await verificationCount();

    const known = await resendCallsDuring(() => callAction(knownRequest));
    const unknown = await resendCallsDuring(() => callAction(unknownRequest));

    expect(known.result).toBeInstanceOf(Response);
    expect(unknown.result).toBeInstanceOf(Response);
    const knownResponse = known.result as Response;
    const unknownResponse = unknown.result as Response;

    expect(unknownResponse).toHaveRedirect(codeLessVerifyUrl(unknownRequest, unknownUsername));
    expect(successShape(unknownResponse)).toEqual(successShape(knownResponse));
    expect(successShape(unknownResponse).status).toBe(302);
    expect(await unknownResponse.clone().text()).not.toContain("No user exists");
    expect(JSON.stringify(successShape(unknownResponse))).not.toContain("No user exists");

    expect(known.calls).toHaveLength(1);
    expect(unknown.calls).toHaveLength(0);
    expect(await verificationCount()).toBe(before + 1);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: unknownUsername, type: "reset-password" } },
      }),
    ).toBeNull();
  });

  test("unknown email gets the same redirect as a known account and does not email or store a verification", async () => {
    const user = await createAccount();
    const unknownEmail = `missing.${user.email}`;
    emailRecipients.push(unknownEmail);
    trackTarget(unknownEmail);
    const knownRequest = forgotPasswordRequest(user.email);
    const unknownRequest = forgotPasswordRequest(unknownEmail);
    const before = await verificationCount();

    const known = await resendCallsDuring(() => callAction(knownRequest));
    const unknown = await resendCallsDuring(() => callAction(unknownRequest));

    expect(known.result).toBeInstanceOf(Response);
    const knownResponse = known.result as Response;
    expect(unknown.result).toBeInstanceOf(Response);
    const unknownResponse = unknown.result as Response;

    expect(knownResponse.status).toBe(unknownResponse.status);
    expect(unknownResponse).toHaveRedirect(codeLessVerifyUrl(unknownRequest, unknownEmail));
    expect(successShape(unknownResponse)).toEqual({
      status: knownResponse.status,
      pathname: "/verify",
      paramNames: ["target", "type"],
      hasCode: false,
      toastCookie: false,
    });
    expect(await unknownResponse.clone().text()).not.toContain("No user exists");

    expect(known.calls).toHaveLength(1);
    expect(unknown.calls).toHaveLength(0);
    await expect(fs.access(emailFixturePath(unknownEmail))).rejects.toThrow();
    expect(await verificationCount()).toBe(before + 1);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: unknownEmail, type: "reset-password" } },
      }),
    ).toBeNull();
  });

  test("a malformed address still returns 400 and does not email or store a verification", async () => {
    const malformed = "not-an-email";
    trackTarget(malformed);
    const request = forgotPasswordRequest(malformed);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 400 },
    });
    expect(validationFieldErrors(result)).toEqual([USERNAME_OR_EMAIL_MESSAGE]);
    expect(JSON.stringify(result)).not.toContain("Invalid input");
    expect(JSON.stringify(result)).not.toContain("No user exists");
    expect(calls).toHaveLength(0);
    expect(await verificationCount()).toBe(before);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: malformed, type: "reset-password" } },
      }),
    ).toBeNull();
  });

  test("a hyphenated identifier that is neither a username nor an email asks for a username or email", async () => {
    const malformed = "qa-auth-nosuchuser";
    trackTarget(malformed);
    const request = forgotPasswordRequest(malformed);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 400 },
    });
    expect(validationFieldErrors(result)).toEqual([USERNAME_OR_EMAIL_MESSAGE]);
    expect(JSON.stringify(result)).not.toContain("Invalid input");
    expect(JSON.stringify(result)).not.toContain("No user exists");
    expect(calls).toHaveLength(0);
    expect(await verificationCount()).toBe(before);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: malformed, type: "reset-password" } },
      }),
    ).toBeNull();
  });

  test("a honeypot failure still returns 400 and does not email or store a verification", async () => {
    const user = await createAccount();
    const request = forgotPasswordRequest(user.username, "i-am-a-bot");
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(async () => {
      try {
        return await callAction(request);
      } catch (error) {
        return error;
      }
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Form not submitted properly");
    expect(calls).toHaveLength(0);
    expect(await verificationCount()).toBe(before);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: user.username, type: "reset-password" } },
      }),
    ).toBeNull();
  });
});

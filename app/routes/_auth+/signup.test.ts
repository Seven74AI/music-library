import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action } from "./signup.tsx";
import { getRedirectToUrl } from "./verify.server.ts";

const HONEYPOT_FIELD = "name__confirm";
const createdUserIds: string[] = [];
const emailRecipients: string[] = [];
const verificationTargets: string[] = [];

function emailFixturePath(recipient: string) {
  return path.join(process.cwd(), "tests", "fixtures", "email", `${recipient}.json`);
}

function signupRequest(email: string, honeypotValue?: string) {
  const form = new FormData();
  form.set("email", email);
  if (honeypotValue !== undefined) {
    form.set(HONEYPOT_FIELD, honeypotValue);
  }
  return new Request("http://localhost/signup", {
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
    pattern: "/signup",
  });
}

function codeLessVerifyUrl(request: Request, email: string) {
  return getRedirectToUrl({ request, type: "onboarding", target: email }).toString();
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
      where: { target: { in: targets }, type: "onboarding" },
    });
  }
  const userIds = createdUserIds.splice(0);
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await Promise.all(
    emailRecipients.splice(0).map((recipient) => fs.rm(emailFixturePath(recipient), { force: true })),
  );
});

describe("signup action", () => {
  test("known email redirects without sending an email or storing a verification", async () => {
    const user = await createAccount();
    const request = signupRequest(user.email);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect(codeLessVerifyUrl(request, user.email));
    expect(successShape(response)).toEqual({
      status: 302,
      pathname: "/verify",
      paramNames: ["target", "type"],
      hasCode: false,
      toastCookie: false,
    });
    expect(calls).toHaveLength(0);
    await expect(fs.access(emailFixturePath(user.email))).rejects.toThrow();
    expect(await verificationCount()).toBe(before);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: user.email, type: "onboarding" } },
      }),
    ).toBeNull();
  });

  test("unknown email sends the welcome email, stores a verification, and redirects", async () => {
    const user = await createAccount();
    const unknownEmail = `missing.${user.email}`;
    emailRecipients.push(unknownEmail);
    trackTarget(unknownEmail);
    const request = signupRequest(unknownEmail);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response).toHaveRedirect(codeLessVerifyUrl(request, unknownEmail));
    expect(successShape(response)).toEqual({
      status: 302,
      pathname: "/verify",
      paramNames: ["target", "type"],
      hasCode: false,
      toastCookie: false,
    });
    expect(calls).toHaveLength(1);
    const email = await readSentEmail(unknownEmail);
    expect(email.to).toBe(unknownEmail);
    expect(email.subject).toMatch(/welcome/i);
    expect(await verificationCount()).toBe(before + 1);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: unknownEmail, type: "onboarding" } },
      }),
    ).not.toBeNull();
  });

  test("known and unknown accounts receive an identical response (no user enumeration)", async () => {
    const user = await createAccount();
    const unknownEmail = `missing.${user.email}`;
    emailRecipients.push(unknownEmail);
    trackTarget(unknownEmail);
    const knownRequest = signupRequest(user.email);
    const unknownRequest = signupRequest(unknownEmail);

    const known = await resendCallsDuring(() => callAction(knownRequest));
    const unknown = await resendCallsDuring(() => callAction(unknownRequest));

    expect(known.result).toBeInstanceOf(Response);
    expect(unknown.result).toBeInstanceOf(Response);
    const knownResponse = known.result as Response;
    const unknownResponse = unknown.result as Response;

    expect(successShape(unknownResponse)).toEqual(successShape(knownResponse));
    expect(successShape(unknownResponse).status).toBe(302);
    expect(await unknownResponse.clone().text()).not.toContain("already exists");
    expect(JSON.stringify(successShape(unknownResponse))).not.toContain("already exists");
  });

  test("a malformed email still returns 400 and does not email or store a verification", async () => {
    const malformed = "not-an-email";
    trackTarget(malformed);
    const request = signupRequest(malformed);
    const before = await verificationCount();

    const { result, calls } = await resendCallsDuring(() => callAction(request));

    expect(result).toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 400 },
    });
    expect(calls).toHaveLength(0);
    expect(await verificationCount()).toBe(before);
    expect(
      await prisma.verification.findUnique({
        where: { target_type: { target: malformed, type: "onboarding" } },
      }),
    ).toBeNull();
  });
});

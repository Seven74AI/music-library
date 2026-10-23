import { faker } from "@faker-js/faker";
import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { action as emailAction } from "./onboarding.tsx";
import {
  action as providerAction,
  providerIdKey,
  providerNameKey,
} from "./onboarding_.$provider.tsx";
import { onboardingEmailSessionKey } from "./onboarding-shared.ts";

const createdUsernames: string[] = [];

type OnboardingData = {
  username: string;
  name: string;
  email: string;
  password: string;
};

function makeOnboardingData(): OnboardingData {
  const { username, name, email } = createUser();
  createdUsernames.push(username);
  return {
    username,
    name,
    email,
    password: faker.internet.password({ length: 20 }),
  };
}

async function buildVerifyCookie(values: Record<string, unknown>) {
  const verifySession = await verifySessionStorage.getSession();
  for (const [key, value] of Object.entries(values)) {
    verifySession.set(key, value);
  }
  return verifySessionStorage.commitSession(verifySession);
}

async function emailSignupRequest(data: OnboardingData) {
  const form = new FormData();
  form.set("username", data.username);
  form.set("name", data.name);
  form.set("password", data.password);
  form.set("confirmPassword", data.password);
  form.set("agreeToTermsOfServiceAndPrivacyPolicy", "on");
  form.set("remember", "on");
  const cookie = await buildVerifyCookie({ [onboardingEmailSessionKey]: data.email });
  return new Request("http://localhost/onboarding", {
    method: "POST",
    body: form,
    headers: { cookie },
  });
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    (result as { type: string }).type === "DataWithResponseInit"
  ) {
    const { data, init } = result as unknown as { data: unknown; init: ResponseInit | null };
    return new Response(JSON.stringify(data), init ?? undefined);
  }
  throw new Error(`Unexpected action result: ${String(result)}`);
}

async function runAction(result: Promise<unknown>): Promise<Response> {
  try {
    return toResponse(await result);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

async function callEmailAction(request: Request): Promise<Response> {
  return runAction(
    emailAction({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: "/onboarding",
    }),
  );
}

async function providerSignupRequest({
  data,
  providerId,
  provider,
  sessionProviderName,
}: {
  data: OnboardingData;
  providerId: string;
  provider: string;
  sessionProviderName: string;
}) {
  const form = new FormData();
  form.set("username", data.username);
  form.set("name", data.name);
  form.set("agreeToTermsOfServiceAndPrivacyPolicy", "on");
  form.set("remember", "on");
  const cookie = await buildVerifyCookie({
    [onboardingEmailSessionKey]: data.email,
    [providerIdKey]: providerId,
    [providerNameKey]: sessionProviderName,
  });
  return new Request(`http://localhost/onboarding/${provider}`, {
    method: "POST",
    body: form,
    headers: { cookie },
  });
}

async function callProviderAction(request: Request, provider: string): Promise<Response> {
  return runAction(
    providerAction({
      request,
      params: { provider },
      context: {} as never,
      url: new URL(request.url),
      pattern: "/onboarding/:provider",
    }),
  );
}

afterEach(async () => {
  const usernames = createdUsernames.splice(0);
  if (usernames.length > 0) {
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
  }
});

describe("email/password onboarding action", () => {
  test("creates a user and session, then redirects home with a welcome toast", async () => {
    const data = makeOnboardingData();
    const response = await callEmailAction(await emailSignupRequest(data));

    expect(response).toHaveRedirect("/");
    expect(response.headers.getSetCookie().some((c) => c.startsWith("en_toast="))).toBe(true);

    const user = await prisma.user.findUnique({ where: { username: data.username } });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(data.email.toLowerCase());
    await expect(response).toHaveSessionForUser(user!.id);
  });

  test("rejects a taken username", async () => {
    const first = makeOnboardingData();
    await callEmailAction(await emailSignupRequest(first));

    const second = makeOnboardingData();
    const request = await emailSignupRequest({ ...second, username: first.username });
    const response = await callEmailAction(request);

    expect(response.status).toBe(400);
    expect(await response.clone().text()).toContain("A user already exists with this username");
  });

  test("rejects mismatched passwords", async () => {
    const data = makeOnboardingData();
    const form = new FormData();
    form.set("username", data.username);
    form.set("name", data.name);
    form.set("password", data.password);
    form.set("confirmPassword", `${data.password}-mismatch`);
    form.set("agreeToTermsOfServiceAndPrivacyPolicy", "on");
    const cookie = await buildVerifyCookie({ [onboardingEmailSessionKey]: data.email });
    const request = new Request("http://localhost/onboarding", {
      method: "POST",
      body: form,
      headers: { cookie },
    });

    const response = await callEmailAction(request);
    expect(response.status).toBe(400);
    expect(await response.clone().text()).toContain("The passwords must match");
  });

  test("redirects to /signup when no verified email is present", async () => {
    const form = new FormData();
    form.set("username", "nobody");
    form.set("name", "Nobody");
    form.set("password", faker.internet.password({ length: 20 }));
    form.set("confirmPassword", "unused");
    const request = new Request("http://localhost/onboarding", {
      method: "POST",
      body: form,
    });

    const response = await callEmailAction(request);
    expect(response).toHaveRedirect("/signup");
  });
});

describe("OAuth onboarding action", () => {
  test("creates a user with a connection and session, then redirects home", async () => {
    const data = makeOnboardingData();
    const providerId = "provider-123";
    const request = await providerSignupRequest({
      data,
      providerId,
      provider: "placeholder",
      sessionProviderName: "placeholder",
    });

    const response = await callProviderAction(request, "placeholder");

    expect(response).toHaveRedirect("/");
    expect(response.headers.getSetCookie().some((c) => c.startsWith("en_toast="))).toBe(true);

    const user = await prisma.user.findUnique({
      where: { username: data.username },
      include: { connections: true },
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(data.email.toLowerCase());
    expect(user?.connections).toHaveLength(1);
    expect(user?.connections[0]?.providerId).toBe(providerId);
    expect(user?.connections[0]?.providerName).toBe("placeholder");
    await expect(response).toHaveSessionForUser(user!.id);
  });

  test("rejects a taken username", async () => {
    const first = makeOnboardingData();
    await callProviderAction(
      await providerSignupRequest({
        data: first,
        providerId: "provider-1",
        provider: "placeholder",
        sessionProviderName: "placeholder",
      }),
      "placeholder",
    );

    const second = makeOnboardingData();
    const request = await providerSignupRequest({
      data: { ...second, username: first.username },
      providerId: "provider-2",
      provider: "placeholder",
      sessionProviderName: "placeholder",
    });

    const response = await callProviderAction(request, "placeholder");
    expect(response.status).toBe(400);
    expect(await response.clone().text()).toContain("A user already exists with this username");
  });

  test("redirects to /signup when the URL provider mismatches the session provider", async () => {
    const data = makeOnboardingData();
    const request = await providerSignupRequest({
      data,
      providerId: "provider-123",
      provider: "google",
      sessionProviderName: "placeholder",
    });

    const response = await callProviderAction(request, "google");
    expect(response).toHaveRedirect("/signup");
  });

  test("redirects to /signup when no verified email is present", async () => {
    const form = new FormData();
    form.set("username", "nobody");
    form.set("name", "Nobody");
    const request = new Request("http://localhost/onboarding/placeholder", {
      method: "POST",
      body: form,
    });

    const response = await callProviderAction(request, "placeholder");
    expect(response).toHaveRedirect("/signup");
  });
});

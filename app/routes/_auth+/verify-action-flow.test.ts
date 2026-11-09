import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { action as signupAction } from "./signup.tsx";
import { action as verifyAction } from "./verify.tsx";
import { codeQueryParam, targetQueryParam, typeQueryParam } from "./verify.tsx";

const CODE_REGEX = /Here's your verification code: (?<code>[\d\w]+)/;
const targets: string[] = [];

function signupRequest(email: string) {
  const form = new FormData();
  form.set("email", email);
  return new Request("http://localhost/signup", {
    method: "POST",
    body: form,
  });
}

afterEach(async () => {
  await prisma.verification.deleteMany({ where: { target: { in: targets }, type: "onboarding" } });
  for (const target of targets.splice(0)) {
    await fs.rm(path.join(process.cwd(), "tests", "fixtures", "email", `${target}.json`), {
      force: true,
    });
  }
});

describe("verify onboarding action flow", () => {
  test("signup then manual verify code redirects to onboarding", async () => {
    const email = `verify-flow-${Date.now()}@example.com`;
    targets.push(email);

    const signupResult = await signupAction({
      request: signupRequest(email),
      params: {},
      context: {} as never,
    } as never);
    expect(signupResult).toBeInstanceOf(Response);

    const emailFixture = JSON.parse(
      await fs.readFile(
        path.join(process.cwd(), "tests", "fixtures", "email", `${email}.json`),
        "utf8",
      ),
    ) as { text: string };
    const code = emailFixture.text.match(CODE_REGEX)?.groups?.code;
    expect(code).toBeTruthy();

    const verifyForm = new FormData();
    verifyForm.set(codeQueryParam, code!);
    verifyForm.set(typeQueryParam, "onboarding");
    verifyForm.set(targetQueryParam, email);

    const verifyResult = await verifyAction({
      request: new Request("http://localhost/verify", { method: "POST", body: verifyForm }),
      params: {},
      context: {} as never,
    } as never);

    const location =
      verifyResult instanceof Response
        ? verifyResult.headers.get("Location")
        : ((verifyResult as { init?: { headers?: Headers } }).init?.headers?.get?.("Location") ??
          null);
    expect(location).toMatch(/\/onboarding/);
  });
});

import { describe, expect, test } from "vitest";
import { prepareVerification } from "./verify.server.ts";
import { action, codeQueryParam, targetQueryParam, typeQueryParam } from "./verify.tsx";

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

async function runAction(request: Request): Promise<{ result: unknown; thrown?: Response }> {
  try {
    return { result: await action({ request } as never) };
  } catch (error) {
    if (error instanceof Response) return { result: null, thrown: error };
    throw error;
  }
}

describe("verify action", () => {
  test("onboarding verification redirects to /onboarding", async () => {
    const email = `verify-action-${Date.now()}@example.com`;
    const request = new Request("http://localhost/signup", { headers: { host: "localhost" } });
    const { otp } = await prepareVerification({
      period: 10 * 60,
      request,
      type: "onboarding",
      target: email,
    });

    const body = new FormData();
    body.set(codeQueryParam, otp);
    body.set(typeQueryParam, "onboarding");
    body.set(targetQueryParam, email);

    const verifyRequest = new Request("http://localhost/verify", {
      method: "POST",
      body,
    });

    const { result, thrown } = await runAction(verifyRequest);
    const response = thrown ?? toResponse(result);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("Location") ?? "").toContain("/onboarding");
  });
});

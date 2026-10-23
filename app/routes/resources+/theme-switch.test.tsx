import { describe, expect, test } from "vitest";
import { action } from "./theme-switch.tsx";

function makeRequest(formData: FormData) {
  return new Request("http://localhost/resources/theme-switch", {
    method: "POST",
    body: formData,
  });
}

describe("theme-switch action", () => {
  test("redirects to a safe same-origin path", async () => {
    const formData = new FormData();
    formData.append("theme", "dark");
    formData.append("redirectTo", "/library");

    const response = await action({ request: makeRequest(formData) } as never);

    expect(response).toBeInstanceOf(Response);
    const res = response as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/library");
  });

  test("does not redirect to an external origin", async () => {
    const formData = new FormData();
    formData.append("theme", "dark");
    formData.append("redirectTo", "https://evil.com/phish");

    const response = await action({ request: makeRequest(formData) } as never);

    expect(response).toBeInstanceOf(Response);
    const res = response as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Location")).not.toContain("evil.com");
  });

  test("does not redirect to a protocol-relative external URL", async () => {
    const formData = new FormData();
    formData.append("theme", "dark");
    formData.append("redirectTo", "//evil.com/phish");

    const response = await action({ request: makeRequest(formData) } as never);

    expect(response).toBeInstanceOf(Response);
    const res = response as Response;
    expect(res.headers.get("Location")).toBe("/");
  });

  test("returns data when no redirectTo is provided", async () => {
    const formData = new FormData();
    formData.append("theme", "light");

    const response = await action({ request: makeRequest(formData) } as never);

    expect(response).not.toBeInstanceOf(Response);
    const init = (response as { init?: { status?: number } | null }).init;
    expect(init?.status ?? 200).toBe(200);
  });
});

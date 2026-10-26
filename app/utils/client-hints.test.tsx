/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { consoleError } from "../../tests/setup/setup-test-env.ts";
import { ClientHintCheck } from "./client-hints.tsx";

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  };
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  document.body.innerHTML = "";
});

function scriptProps(script: Element) {
  const fiberKey = Object.keys(script).find((key) => key.startsWith("__reactFiber"));
  if (!fiberKey) throw new Error("script fiber missing");
  const fiber = (
    script as unknown as Record<string, { memoizedProps: { suppressHydrationWarning?: boolean } }>
  )[fiberKey];
  if (!fiber) throw new Error("script fiber missing");
  return fiber.memoizedProps;
}

test("client hint script keeps the server nonce without a hydration mismatch", () => {
  consoleError.mockImplementation(() => {});
  const html = renderToString(createElement(ClientHintCheck, { nonce: "server-nonce" }));
  expect(html).toContain('nonce="server-nonce"');

  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  container.querySelector("script")?.setAttribute("nonce", "");
  hydrateRoot(container, createElement(ClientHintCheck, { nonce: "" }));
  expect(container.querySelector("script")?.textContent).toContain("client hints");

  const view = render(createElement(ClientHintCheck, { nonce: "server-nonce" }));
  const script = view.container.querySelector("script");
  expect(scriptProps(script!).suppressHydrationWarning).toBe(true);
  const hydrationErrors = consoleError.mock.calls
    .map((call) => call.map((part) => String(part)).join(" "))
    .filter((message) => /hydrat/i.test(message));
  expect(hydrationErrors).toEqual([]);
});

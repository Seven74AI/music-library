/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { NonceProvider, useNonce } from "./nonce-provider.ts";

function Probe() {
  return <span data-testid="nonce">{useNonce()}</span>;
}

describe("NonceProvider / useNonce", () => {
  test("defaults to empty string so client hydration matches browser-cleared nonce attrs", () => {
    render(<Probe />);
    expect(screen.getByTestId("nonce")).toHaveTextContent("");
  });

  test("SSR provider supplies the request nonce", () => {
    const html = renderToStaticMarkup(
      createElement(NonceProvider, { value: "request-nonce" }, createElement(Probe)),
    );

    expect(html).toContain("request-nonce");
  });
});

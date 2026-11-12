import { expect, test } from "vitest";
import { escapeHtml } from "./escape-html.ts";

test("escapes & < > and double quotes", () => {
  expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("leaves apostrophes alone unless asked", () => {
  expect(escapeHtml("it's")).toBe("it's");
  expect(escapeHtml("it's", { apostrophe: true })).toBe("it&#39;s");
});

test("does not double-escape in a single pass", () => {
  expect(escapeHtml("&lt;")).toBe("&amp;lt;");
});

import { describe, expect, test } from "vitest";
import { escapeLikeLiterals, toLiteralFts5Query } from "./fts5-query.server.ts";

describe("toLiteralFts5Query", () => {
  test.each([
    ["", ""],
    ["   ", ""],
    ["-", ""],
    ["*", ""],
    ["***", ""],
    ["???", ""],
    ["- * ^", ""],
  ])("punctuation-only %j yields empty query", (input, expected) => {
    expect(toLiteralFts5Query(input)).toBe(expected);
  });

  test.each([
    ["AC-DC", '"AC-DC"*'],
    ["AC-", '"AC-"*'],
    ["meryl", '"meryl"*'],
    ["AND", '"AND"*'],
    ["OR", '"OR"*'],
    ["NOT", '"NOT"*'],
    ["NEAR(", '"NEAR("*'],
    ["col:name", '"col:name"*'],
    ["^start", '"^start"*'],
    ["(a)", '"(a)"*'],
    ["{x}", '"{x}"*'],
    ["a+b", '"a+b"*'],
    ['"quoted"', '"""quoted"""*'],
    ["it's", `"it's"*`],
    ["foo bar", '"foo"* "bar"*'],
    ["  foo   bar  ", '"foo"* "bar"*'],
    ["foo - bar", '"foo"* "bar"*'],
  ])("literalizes %j → %j", (input, expected) => {
    expect(toLiteralFts5Query(input)).toBe(expected);
  });

  test("prefix false omits trailing *", () => {
    expect(toLiteralFts5Query("AC-DC", { prefix: false })).toBe('"AC-DC"');
    expect(toLiteralFts5Query("foo bar", { prefix: false })).toBe('"foo" "bar"');
  });

  test("keeps unicode letters as searchable", () => {
    expect(toLiteralFts5Query("café")).toBe('"café"*');
    expect(toLiteralFts5Query("日本語")).toBe('"日本語"*');
  });
});

describe("escapeLikeLiterals", () => {
  test.each([
    ["plain", "plain"],
    ["100%", "100\\%"],
    ["a_b", "a\\_b"],
    ["a\\b", "a\\\\b"],
    ["%_\\", "\\%\\_\\\\"],
  ])("escapes %j → %j", (input, expected) => {
    expect(escapeLikeLiterals(input)).toBe(expected);
  });
});

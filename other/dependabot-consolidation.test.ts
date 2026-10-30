import { describe, expect, test } from "vitest";
import {
  detectConsolidation,
  isDependabotPr,
  matchesExclusion,
  parseExclusions,
  type DependabotPr,
  type Exclusion,
} from "./dependabot-consolidation.ts";

function pr(
  overrides: Partial<DependabotPr> & Pick<DependabotPr, "number" | "title">,
): DependabotPr {
  return {
    author: "app/dependabot",
    labels: ["dependencies", "javascript"],
    ...overrides,
  };
}

const nodeExclusion: Exclusion = {
  ecosystem: "docker",
  dependency: "node",
  reason: "engines and CI pin Node 24",
};

describe("isDependabotPr", () => {
  test("matches both author logins", () => {
    expect(isDependabotPr(pr({ number: 1, title: "x", author: "app/dependabot" }))).toBe(true);
    expect(isDependabotPr(pr({ number: 2, title: "x", author: "dependabot[bot]" }))).toBe(true);
  });

  test("rejects non-Dependabot authors", () => {
    expect(isDependabotPr(pr({ number: 3, title: "x", author: "app/cursor" }))).toBe(false);
  });
});

describe("matchesExclusion", () => {
  test("matches node image bump with docker label", () => {
    const node = pr({
      number: 662,
      title: "chore(deps): bump node from 24-bookworm-slim to 25-bookworm-slim in /other",
      labels: ["dependencies", "docker"],
    });
    expect(matchesExclusion(node, nodeExclusion)).toBe(true);
  });

  test("does not match on word prefix (node-fetch)", () => {
    const nodeFetch = pr({
      number: 4,
      title: "chore(deps): bump node-fetch from 3.3.2 to 3.3.3",
      labels: ["dependencies", "javascript"],
    });
    expect(matchesExclusion(nodeFetch, nodeExclusion)).toBe(false);
  });

  test("does not match when ecosystem label is absent", () => {
    const node = pr({
      number: 5,
      title: "chore(deps): bump node from 24-bookworm-slim to 25-bookworm-slim in /other",
      labels: ["dependencies", "javascript"],
    });
    expect(matchesExclusion(node, nodeExclusion)).toBe(false);
  });
});

describe("parseExclusions", () => {
  test("parses version 1 file", () => {
    const parsed = parseExclusions(
      JSON.stringify({
        version: 1,
        exclusions: [{ ecosystem: "docker", dependency: "node", reason: "r" }],
      }),
    );
    expect(parsed.exclusions).toHaveLength(1);
    expect(parsed.exclusions[0]?.dependency).toBe("node");
  });

  test("rejects unsupported version", () => {
    expect(() => parseExclusions(JSON.stringify({ version: 2, exclusions: [] }))).toThrow(
      "Unsupported exclusion file version",
    );
  });
});

describe("detectConsolidation", () => {
  const exclusions = { version: 1 as const, exclusions: [nodeExclusion] };

  test("folds Dependabot PRs and excludes node bump", () => {
    const node = pr({
      number: 662,
      title: "chore(deps): bump node from 24-bookworm-slim to 25-bookworm-slim in /other",
      labels: ["dependencies", "docker"],
    });
    const vite = pr({ number: 672, title: "chore(deps-dev): bump vite from 8.3.3 to 8.3.5" });
    const cursor = pr({
      number: 670,
      title: "fix(party-room): keep the guest host seat",
      author: "app/cursor",
    });

    const result = detectConsolidation([node, vite, cursor], exclusions);

    expect(result.fold.map((p) => p.number)).toEqual([672]);
    expect(result.excluded.map((e) => e.pr.number)).toEqual([662]);
    expect(result.excluded[0]?.exclusion.reason).toBe("engines and CI pin Node 24");
  });

  test("ignores non-Dependabot PRs entirely", () => {
    const cursor = pr({ number: 670, title: "fix: something", author: "app/cursor" });
    const result = detectConsolidation([cursor], exclusions);
    expect(result.fold).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });
});

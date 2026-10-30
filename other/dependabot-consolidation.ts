import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type DependabotPr = {
  number: number;
  title: string;
  author: string;
  labels: string[];
};

export type Exclusion = {
  ecosystem: string;
  dependency: string;
  reason: string;
};

export type ExclusionFile = {
  version: 1;
  exclusions: Exclusion[];
};

export type ConsolidationResult = {
  fold: DependabotPr[];
  excluded: { pr: DependabotPr; exclusion: Exclusion }[];
};

const ECOSYSTEM_LABEL: Record<string, string> = {
  npm: "javascript",
  docker: "docker",
  "github-actions": "github_actions",
};

function escapeRegExp(value: string) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A PR is a Dependabot PR when its author is the Dependabot bot (the author
 * login is `app/dependabot` in the REST list view and `dependabot[bot]` in the
 * GraphQL view). Matching on the `dependencies` label is not used because a
 * human could apply it; the author is the reliable signal.
 */
export function isDependabotPr(pr: DependabotPr) {
  return pr.author === "app/dependabot" || pr.author === "dependabot[bot]";
}

/**
 * An exclusion matches when the PR carries the ecosystem's label (e.g.
 * `docker` for a Docker image bump) and the dependency name appears as a whole
 * word in the title (`node` matches "bump node from 24-… to 25-…", not
 * "node-fetch").
 */
export function matchesExclusion(pr: DependabotPr, exclusion: Exclusion) {
  const ecosystemLabel = ECOSYSTEM_LABEL[exclusion.ecosystem];
  if (!ecosystemLabel || !pr.labels.includes(ecosystemLabel)) {
    return false;
  }
  const pattern = new RegExp(`\\b${escapeRegExp(exclusion.dependency)}\\b`);
  return pattern.test(pr.title);
}

export function parseExclusions(raw: string): ExclusionFile {
  const parsed = JSON.parse(raw) as ExclusionFile;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported exclusion file version: ${parsed.version}`);
  }
  return parsed;
}

export function loadExclusions(): ExclusionFile {
  const raw = readFileSync(path.join(repoRoot, ".github", "dependabot-consolidation.json"), "utf8");
  return parseExclusions(raw);
}

/**
 * Split open Dependabot PRs into the set to fold into the consolidation PR and
 * the set to leave open (excluded bumps). Non-Dependabot PRs are ignored.
 */
export function detectConsolidation(
  prs: DependabotPr[],
  exclusions: ExclusionFile,
): ConsolidationResult {
  const fold: DependabotPr[] = [];
  const excluded: { pr: DependabotPr; exclusion: Exclusion }[] = [];

  for (const pr of prs) {
    if (!isDependabotPr(pr)) {
      continue;
    }
    const matching = exclusions.exclusions.find((exclusion) => matchesExclusion(pr, exclusion));
    if (matching) {
      excluded.push({ pr, exclusion: matching });
    } else {
      fold.push(pr);
    }
  }

  return { fold, excluded };
}

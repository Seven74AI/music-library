import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type DependabotGroup = {
  patterns: string[];
};

type DependabotUpdate = {
  "package-ecosystem": string;
  directory: string;
  schedule: {
    interval: string;
    day?: string;
    time: string;
    timezone: string;
  };
  "open-pull-requests-limit": number;
  "versioning-strategy"?: string;
  labels?: string[];
  "commit-message": {
    prefix: string;
    "prefix-development"?: string;
    include: string;
  };
  groups?: Record<string, DependabotGroup>;
};

type DependabotConfig = {
  version: number;
  updates: DependabotUpdate[];
};

const dailyParis = {
  interval: "daily",
  time: "09:00",
  timezone: "Europe/Paris",
} as const;

const npmGroups: Record<string, string[]> = {
  prisma: ["prisma", "@prisma/*"],
  react: ["react", "react-dom", "@types/react", "@types/react-dom"],
  "react-router": ["react-router", "@react-router/*", "@remix-run/*"],
  testing: ["@playwright/*", "vitest", "@vitest/*", "@testing-library/*"],
  tailwind: ["tailwindcss", "@tailwindcss/*"],
  oxc: ["oxlint", "oxfmt"],
  aws: ["@aws-sdk/*"],
  conform: ["@conform-to/*"],
  dnd: ["@dnd-kit/*"],
  sentry: ["@sentry/*"],
  serwist: ["serwist", "@serwist/*"],
  radix: ["@radix-ui/*"],
  tanstack: ["@tanstack/*"],
  webauthn: ["@simplewebauthn/*"],
};

/**
 * Dependabot group patterns are full-string globs. `*` matches any sequence,
 * and a name that matches more than one group is filed under the first.
 */
function matchesDependabotPattern(dependencyName: string, pattern: string) {
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${expression}$`).test(dependencyName);
}

function groupFor(dependencyName: string, groups: Record<string, DependabotGroup>) {
  for (const [groupName, group] of Object.entries(groups)) {
    if (group.patterns.some((pattern) => matchesDependabotPattern(dependencyName, pattern))) {
      return groupName;
    }
  }
  return null;
}

function loadDependabotConfig() {
  const raw = readFileSync(path.join(repoRoot, ".github", "dependabot.yml"), "utf8");
  return parse(raw) as DependabotConfig;
}

describe("dependabot config", () => {
  test("schedules npm, GitHub Actions, and the Docker image together", () => {
    const config = loadDependabotConfig();
    expect(config.version).toBe(2);

    const ecosystems = config.updates.map((update) => ({
      ecosystem: update["package-ecosystem"],
      directory: update.directory,
    }));
    expect(ecosystems).toEqual([
      { ecosystem: "npm", directory: "/" },
      { ecosystem: "github-actions", directory: "/" },
      { ecosystem: "docker", directory: "/other" },
    ]);

    for (const update of config.updates) {
      expect(update.schedule).toEqual(dailyParis);
      expect(update["commit-message"]).toMatchObject({
        prefix: "chore",
        include: "scope",
      });
      expect(update.labels).toBeUndefined();
      expect(update["open-pull-requests-limit"]).toBe(20);
    }

    const npm = config.updates[0];
    expect(npm).toBeDefined();
    expect(npm?.["versioning-strategy"]).toBe("increase");
    expect(npm?.["commit-message"]["prefix-development"]).toBe("chore");

    const actions = config.updates[1];
    expect(actions?.["versioning-strategy"]).toBeUndefined();
    expect(actions?.["commit-message"]["prefix-development"]).toBeUndefined();

    const docker = config.updates[2];
    expect(docker?.["versioning-strategy"]).toBeUndefined();
    expect(existsSync(path.join(repoRoot, "other", "Dockerfile"))).toBe(true);
    expect(
      readdirSync(path.join(repoRoot, ".github", "workflows")).some((fileName) =>
        /^\w.*\.(yml|yaml)$/.test(fileName),
      ),
    ).toBe(true);
  });

  test("groups packages that must move together and drops the Remix and ESLint groups", () => {
    const config = loadDependabotConfig();
    const npm = config.updates.find((update) => update["package-ecosystem"] === "npm");
    expect(npm?.groups).toBeDefined();
    const groups = npm?.groups ?? {};

    expect(Object.keys(groups)).toEqual(Object.keys(npmGroups));
    for (const [groupName, patterns] of Object.entries(npmGroups)) {
      expect(groups[groupName]?.patterns).toEqual(patterns);
    }
    expect(groups).not.toHaveProperty("eslint");
    expect(groups).not.toHaveProperty("remix");

    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const directDependencies = [
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.devDependencies),
    ];

    const expectedGroupByDependency: Record<string, string> = {
      prisma: "prisma",
      "@prisma/client": "prisma",
      react: "react",
      "react-dom": "react",
      "@types/react": "react",
      "@types/react-dom": "react",
      "react-router": "react-router",
      "@react-router/express": "react-router",
      "@react-router/dev": "react-router",
      "@remix-run/server-runtime": "react-router",
      "@playwright/test": "testing",
      vitest: "testing",
      "@vitest/coverage-v8": "testing",
      "@testing-library/react": "testing",
      tailwindcss: "tailwind",
      "@tailwindcss/vite": "tailwind",
      oxlint: "oxc",
      oxfmt: "oxc",
      "@aws-sdk/client-s3": "aws",
      "@conform-to/zod": "conform",
      "@dnd-kit/sortable": "dnd",
      "@sentry/react-router": "sentry",
      "@sentry/profiling-node": "sentry",
      serwist: "serwist",
      "@serwist/build": "serwist",
      "@radix-ui/react-dialog": "radix",
      "@tanstack/react-query": "tanstack",
      "@simplewebauthn/server": "webauthn",
    };

    for (const [dependencyName, groupName] of Object.entries(expectedGroupByDependency)) {
      expect(directDependencies).toContain(dependencyName);
      expect(groupFor(dependencyName, groups)).toBe(groupName);
    }

    expect(groupFor("react-router", groups)).toBe("react-router");
    expect(groupFor("react-dom", groups)).toBe("react");
  });
});

describe("pnpm allowBuilds", () => {
  test("approves install scripts with booleans", () => {
    const raw = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    const workspace = parse(raw) as { allowBuilds?: Record<string, unknown> };

    expect(workspace.allowBuilds).toEqual({
      "@prisma/engines": true,
      "@sentry/cli": true,
      "@sentry/node-cpu-profiler": true,
      "better-sqlite3": true,
      esbuild: true,
      msw: true,
      prisma: true,
    });
    expect(raw).not.toContain("set this to true or false");
    expect(raw).not.toContain("unrs-resolver");
  });
});

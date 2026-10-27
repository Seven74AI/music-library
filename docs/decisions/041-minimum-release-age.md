# ADR-041: Seven-day minimum release age

## Status

Accepted

**Date:** 2026-10-27

## Context

A dependency version can be malicious in the hours after it is published, and then yanked. That is the failure people often call package poisoning. The control is a **minimum release age**: do not resolve a version until it has been public long enough for the registry and the community to catch a bad release.

This repo chooses new versions in three places:

- npm, for `npm install` and `npm update` (`package-lock.json`, CI, and the production image)
- pnpm (`pnpm-lock.yaml` and `pnpm-workspace.yaml`)
- Dependabot version updates for npm, GitHub Actions, and Docker

A wait in only one of those places leaves the others free to pick up a release the day it is published. Dependabot's own default cooldown is 3 days, and it applies only to Dependabot version updates.

## Decision

Wait **7 days** everywhere a new version is chosen. No package, ecosystem, or semver class is exempt.

| Surface                                    | Setting                                                | Unit                  |
| ------------------------------------------ | ------------------------------------------------------ | --------------------- |
| npm                                        | `.npmrc` `min-release-age=7`                           | days                  |
| pnpm                                       | `pnpm-workspace.yaml` `minimumReleaseAge: 10080`       | minutes (7 × 24 × 60) |
| Dependabot npm, GitHub Actions, and Docker | `cooldown.default-days: 7` in `.github/dependabot.yml` | days                  |

Do not set `min-release-age-exclude`, `minimumReleaseAgeExclude`, a Dependabot `include` or `exclude` list, or a shorter `semver-major-days` / `semver-minor-days` / `semver-patch-days`.

`other/dependabot-config.test.ts` requires these three settings and rejects an exclusion list.

### What still moves immediately

- **Dependabot security updates.** GitHub does not apply `cooldown` to them. For npm, Dependabot installs the advisory with `--min-release-age=0`, so `.npmrc` does not block that pull request.
- **`npm ci` and the production image build.** They install `package-lock.json` as written and do not re-resolve. The age check runs when the lockfile is updated, not when it is installed.
- **An already locked version** stays until someone updates it.

### Emergency exception

Land one urgent package with a one-off flag (`npm install --min-release-age=0`, or the matching pnpm override for that command). Do not commit an exclude list, and do not lower the shared 7-day value. If `npm audit fix` is blocked because the patched version is younger than 7 days, npm keeps the current version, warns, and exits non-zero.

## Consequences

- A release published today cannot be resolved by npm or pnpm, or opened by Dependabot as a version update, until it is 7 days old.
- A known vulnerability still gets a Dependabot security pull request without waiting.
- pnpm 11 treats an explicit `minimumReleaseAge` as strict. If every version in the requested range is younger than 7 days, the install fails instead of taking the new one. npm errors in the same situation.
- The wait does not stop malware that stays live longer than 7 days, and it does not fix a bug that already shipped in an older version.

## Rejected

- Dependabot's default 3-day cooldown alone. It does not cover a manual `npm install` or `pnpm` resolution.
- pnpm's default of 1 day.
- Different waits for patch, minor, and major bumps.
- A package exclude list.
- Holding Dependabot security updates for 7 days. The product does not support that, and it would delay a known fix.
- Comments in the config files with no decision record.

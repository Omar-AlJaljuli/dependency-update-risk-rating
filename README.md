# dependency-update-risk-rating

A [Claude Code skill](https://code.claude.com/docs/en/skills) that analyses and
**rates the risk of npm dependency updates** — primarily Dependabot/Renovate
pull requests that touch `package.json` or `yarn.lock` (including lockfile-only
PRs), but also local diffs and single package bumps.

The output is a per-package risk table, an overall **LOW / MEDIUM / HIGH** band
with a 0–100 score, and a merge recommendation:

```
## Dependency update risk: LOW (0/100)

| Package | Change            | Risk | Score | Why |
|---------|-------------------|------|-------|-----|
| lodash  | 4.17.20 -> 4.17.21 | LOW | 0     | fixes known vulnerabilities: GHSA-... (-2); changelog: bugfixes only (-1) |

**Recommendation:** Safe to merge. Test coverage is high; a green CI run is a strong signal.
```

## How it works

Deterministic TypeScript scripts (zero npm dependencies, run directly by
Node >= 22.18 — no compile step) gather the facts; Claude contributes only the
qualitative changelog judgment; a scorer combines everything reproducibly:

```
detect-changes.ts   git diff | package@from->to | GitHub PR (raw file fetch)
      |                       full-file lockfile comparison (yarn v1, yarn
      v                       berry, package-lock; never unified-diff parsing)
collect-metrics.ts  npm registry (age, deprecation, install scripts, publisher,
      |             license, provenance), weekly downloads, OSV vulnerabilities
      |             (fixed vs introduced), OpenSSF Scorecard, support levels
      v
check-backstage.ts  @backstage/* versions vs the release manifest for the
      |             version pinned in the repo's backstage.json
      v
fetch-codecov.ts    coverage per workspace (codecov.io) or manual overrides
      |
      v
score.ts            metrics + changelog judgments + config -> risk table
```

## Rating criteria

1. **Number of affected packages** — lockfile-wide, direct vs transitive.
2. **Version delta** — patch / minor / major; on `0.x` versions a minor bump
   counts as major (Backstage convention).
3. **Age of the new version** — younger than 3 days (configurable) is risky.
4. **Trust list** — `@red-hat-developer-hub/*` updates are always OK (capped
   LOW), unless a security signal fires (configurable).
5. **Backstage alignment** — `@backstage/*` bumps are checked against the
   official release manifest for the version in the repo's `backstage.json`.
6. **Changelog analysis** — Dependabot/Renovate release notes are summarized;
   a major bump whose only breaking change is dropping EOL Node.js support is
   treated as low risk.
7. **Adoption** — weekly downloads from npmjs.
8. **Test confidence** — coverage from codecov.io (or a manual setting) shapes
   the recommendation ("trust CI" vs "verify manually").
9. **Support level** — production / tech-preview / dev-preview for
   Backstage-ecosystem packages, maintained in this repo
   (`scripts/data/support-levels.yaml`).

Additional signals included: known vulnerabilities fixed/introduced (OSV.dev),
deprecation, newly added install scripts, publisher changes, license changes,
prerelease targets, version downgrades, npm provenance attestations, OpenSSF
Scorecard (informational). Ideas not yet implemented: bundle-size deltas
(bundlephobia), `npm diff` code inspection, typosquat detection for newly
added packages, release-cadence signals.

The full scoring model: [references/scoring.md](.claude/skills/dependency-update-risk-rating/references/scoring.md).

## Using the skill

With the skill installed, just ask Claude Code:

- *"Review the dependency update in PR #123"* / paste a Dependabot PR URL
- *"Rate this dependency change"* (with local package.json/yarn.lock changes)
- *"How risky is updating lodash 4.17.20 to 4.17.21?"*

Add `.dependency-risk.yaml` to the target repo root to tune trust lists,
thresholds, weights, and codecov mapping — see the annotated
[example config](.dependency-risk.yaml) and
[references/config.md](.claude/skills/dependency-update-risk-rating/references/config.md).
No config is required; defaults apply.

## Installation

Copy the skill directory into the target repo (project skill):

```bash
cp -r .claude/skills/dependency-update-risk-rating <target-repo>/.claude/skills/
```

or into `~/.claude/skills/` to make it available in every project.

Requirements: Node.js >= 22.18 (native TypeScript type stripping) and outbound
HTTPS to `registry.npmjs.org`, `api.npmjs.org`, `api.osv.dev`,
`raw.githubusercontent.com`, and optionally `versions.backstage.io`,
`api.securityscorecards.dev`, `api.codecov.io`. Unreachable hosts degrade to
reported "data gaps", never failures.

## Development

```bash
tests/run-tests.sh    # offline: lockfile-parser fixtures, lib unit tests, scoring golden files
```

Scripts live in `.claude/skills/dependency-update-risk-rating/scripts/`; each
supports `--help` and prints JSON to stdout, keeping large data out of the
model context.

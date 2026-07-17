#!/usr/bin/env node
// Table tests for the skill's lib modules (semver, yaml, match, support).
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillScripts = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude/skills/dependency-update-risk-rating/scripts',
);

const { classifyDelta, compareVersions, parseVersion, maxVersion, concreteVersion } = await import(path.join(skillScripts, 'lib/semver.ts'));
const { parseYaml, loadConfig, CONFIG_DEFAULTS } = await import(path.join(skillScripts, 'lib/yaml.ts'));
const { matchPattern, matchAny } = await import(path.join(skillScripts, 'lib/match.ts'));
const { loadSupportData, resolveSupportLevel } = await import(path.join(skillScripts, 'lib/support.ts'));

// --- semver ---------------------------------------------------------------
assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] });
assert.deepEqual(parseVersion('v1.2.3-beta.1+build'), { major: 1, minor: 2, patch: 3, prerelease: ['beta', '1'] });
assert.equal(parseVersion('not-a-version'), null);

const deltaCases: Array<[string, string, string, string, boolean, boolean]> = [
  // from, to, type, effectiveType, downgrade, prereleaseTarget
  ['4.17.20', '4.17.21', 'patch', 'patch', false, false],
  ['1.2.3', '2.0.0', 'major', 'major', false, false],
  ['1.2.3', '1.3.0', 'minor', 'minor', false, false],
  ['0.5.1', '0.6.0', 'minor', 'major', false, false],
  ['0.5.1', '0.5.2', 'patch', 'minor', false, false],
  ['2.0.0', '2.0.0-beta.1', 'prerelease', 'prerelease', true, true],
  ['1.0.0-alpha', '1.0.0', 'prerelease', 'prerelease', false, false],
  ['3.1.0', '3.0.9', 'minor', 'minor', true, false],
  ['1.0.0', '1.0.0', 'same', 'same', false, false],
];
for (const [from, to, type, effectiveType, downgrade, prereleaseTarget] of deltaCases) {
  assert.deepEqual(classifyDelta(from, to), { type, effectiveType, downgrade, prereleaseTarget }, `${from} -> ${to}`);
}
assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')! < 0, true);
assert.equal(compareVersions('1.0.0-rc.1', '1.0.0')! < 0, true);

// semver max, not lexicographic max: "10.1.0" > "9.4.0"
assert.equal(maxVersion(['9.4.0', '10.1.0']), '10.1.0');
assert.equal(maxVersion(['2.0.0', '2.1.2']), '2.1.2');
assert.equal(concreteVersion('9.4.0, 10.1.0'), '10.1.0');
assert.equal(concreteVersion('^4.1.0'), '4.1.0');
assert.equal(concreteVersion('workspace:*'), null);
assert.equal(concreteVersion(null), null);

// --- yaml -----------------------------------------------------------------
assert.deepEqual(
  parseYaml(`
# comment
a: 1
b: text with spaces
c:
  nested: true
  "quoted key": "quoted value"
list:
  - one
  - 2
  - "@scope/*"
flowMap: { x: 1, y: [a, b] }
empty: null
maps:
  - name: first
    value: 1
  - name: second
`),
  {
    a: 1,
    b: 'text with spaces',
    c: { nested: true, 'quoted key': 'quoted value' },
    list: ['one', 2, '@scope/*'],
    flowMap: { x: 1, y: ['a', 'b'] },
    empty: null,
    maps: [{ name: 'first', value: 1 }, { name: 'second' }],
  },
);
assert.throws(() => parseYaml('a: [1, 2'), /flow collection/);

const defaults = loadConfig(null);
assert.equal(defaults.minAgeDays, CONFIG_DEFAULTS.minAgeDays);
assert.match(defaults.configSource, /defaults/);

// "none" sentinel forces defaults even when the cwd has a config file
const none = loadConfig('none');
assert.match(none.configSource, /none/);
assert.equal(none.bands.high, CONFIG_DEFAULTS.bands.high);

// The example config in the repo root must load without errors.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleConfig = loadConfig(repoRoot);
assert.deepEqual(exampleConfig.trustedPackages, ['@red-hat-developer-hub/*']);
assert.equal(exampleConfig.bands.high, 6);

// --- match ----------------------------------------------------------------
assert.equal(matchPattern('@red-hat-developer-hub/foo', '@red-hat-developer-hub/*'), true);
assert.equal(matchPattern('@red-hat-developer-hubx/foo', '@red-hat-developer-hub/*'), false);
assert.equal(matchPattern('lodash', 'lodash'), true);
assert.equal(matchPattern('lodash.merge', 'lodash'), false);
assert.equal(matchAny('@backstage/core', ['x', '@backstage/*']), true);

// --- support --------------------------------------------------------------
const support = loadSupportData();
assert.deepEqual(resolveSupportLevel('@red-hat-developer-hub/foo', support), { level: 'production', scoreAdjust: 0 });
assert.equal(resolveSupportLevel('lodash', support).level, null);
assert.equal(resolveSupportLevel('@backstage-community/plugin-anything', support).level, 'unknown');

// --- score behavior -------------------------------------------------------
const { scoreAll } = await import(path.join(skillScripts, 'score.ts'));
const baseMetrics = JSON.parse(
  (await import('node:fs')).readFileSync(path.join(repoRoot, 'tests/fixtures/metrics-basic.json'), 'utf8'),
);

// all-unknown coverage must report testConfidence 'unknown', not 'medium'
const unknownCov = scoreAll({
  metrics: baseMetrics,
  codecov: { workspaces: [{ path: '.', coverage: null, confidence: 'unknown', source: 'none' }] },
  config: defaults,
});
assert.equal(unknownCov.overall.testConfidence, 'unknown');

// a trusted package that adds an install script keeps its real (uncapped) score
const trustedEvil = structuredClone(baseMetrics);
trustedEvil.packages = [{ ...trustedEvil.packages[1], name: '@red-hat-developer-hub/evil', trusted: true }];
const trustedScored = scoreAll({ metrics: trustedEvil, config: defaults });
assert.equal(trustedScored.packages[0].band, 'HIGH');
assert.ok(trustedScored.packages[0].flags.includes('trusted-but-security-signal'));

// backstage.enabled: false ignores the manifest check entirely
const bsDisabled = scoreAll({
  metrics: baseMetrics,
  backstage: { release: '1.39.0', results: [{ name: 'lodash', status: 'mismatch', expected: '9.9.9' }] },
  config: { ...defaults, backstage: { enabled: false } },
});
assert.equal(bsDisabled.backstageRelease, null);
assert.ok(!bsDisabled.packages.some((p: { reasons: Array<{ label: string }> }) => p.reasons.some((r) => r.label.includes('Backstage'))));

console.log('unit tests: OK');

#!/usr/bin/env bash
# Offline test suite for the dependency-update-risk-rating skill.
# Requires Node >= 22.18 (native TypeScript type stripping).
set -euo pipefail
cd "$(dirname "$0")/.."

SCRIPTS=.claude/skills/dependency-update-risk-rating/scripts
FIX=tests/fixtures
EXP=tests/expected
fail=0

echo "== unit tests (semver / yaml / match / support)"
node tests/unit.ts

check() {
  local name="$1"; shift
  local expected="$1"; shift
  if diff -u "$expected" <("$@") >/tmp/dep-risk-test-diff 2>&1; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    cat /tmp/dep-risk-test-diff
    fail=1
  fi
}

echo "== compare-manifests fixtures"
check "yarn v1 lock + package.json" "$EXP/yarn-v1.json" \
  node "$SCRIPTS/compare-manifests.ts" \
  --old-lock "$FIX/yarn-v1-old.lock" --new-lock "$FIX/yarn-v1-new.lock" \
  --old-pkg "$FIX/package-old.json" --new-pkg "$FIX/package-new.json"
check "yarn berry lock" "$EXP/yarn-berry.json" \
  node "$SCRIPTS/compare-manifests.ts" \
  --old-lock "$FIX/yarn-berry-old.lock" --new-lock "$FIX/yarn-berry-new.lock"
check "package-lock v3" "$EXP/package-lock.json" \
  node "$SCRIPTS/compare-manifests.ts" \
  --old-lock "$FIX/package-lock-old.json" --new-lock "$FIX/package-lock-new.json"
check "package.json only" "$EXP/package-json-only.json" \
  node "$SCRIPTS/compare-manifests.ts" \
  --old-pkg "$FIX/package-old.json" --new-pkg "$FIX/package-new.json"

echo "== score.ts golden files"
check "score basic (json)" "$EXP/score-basic.json" \
  node "$SCRIPTS/score.ts" --metrics "$FIX/metrics-basic.json" \
  --judgments "$FIX/judgments-basic.json"
check "score basic (markdown)" "$EXP/score-basic.md" \
  node "$SCRIPTS/score.ts" --metrics "$FIX/metrics-basic.json" \
  --judgments "$FIX/judgments-basic.json" --format md

if [ "$fail" -ne 0 ]; then
  echo "TESTS FAILED"
  exit 1
fi
echo "ALL TESTS PASSED"

#!/bin/bash
# Verification before a commit: compile, types, lint, tests, secrets, stray prints, git status.
# Needs the database from docker-compose.yml running. Exits non-zero if a check fails.
set -u
cd "$(dirname "$0")/.."
fail=0
label() { printf '%-9s' "$1"; }

label "Build:"
if .venv/bin/python -m compileall -q backend/wikilens >/dev/null; then echo OK; else echo FAIL; fail=1; fi

label "Types:"
if out=$(.venv/bin/mypy backend/wikilens 2>&1); then echo OK; else echo FAIL; echo "$out" | tail -15; fail=1; fi

label "Lint:"
if out=$(.venv/bin/ruff check backend 2>&1); then echo OK; else echo FAIL; echo "$out" | tail -20; fail=1; fi

label "Tests:"
out=$(.venv/bin/pytest backend/tests -q 2>&1); rc=$?
summary=$(echo "$out" | grep -E "[0-9]+ (passed|failed|error)" | tail -1)
coverage=$(echo "$out" | awk '/^TOTAL/ {print $NF}')
echo "${summary:-no summary}, coverage ${coverage:-n/a}"
if [ $rc -ne 0 ]; then echo "$out" | tail -25; fail=1; fi

label "Secrets:"
hits=$(git ls-files -co --exclude-standard | grep -v -E '(\.env\.example|scripts/verify\.sh)$' \
  | xargs grep -nIE "(PASSWORD|SECRET|TOKEN|API_KEY)[A-Z_]*[[:space:]]*[=:][[:space:]]*['\"]?[A-Za-z0-9+/_-]{12,}" 2>/dev/null)
if [ -z "$hits" ]; then echo OK; else echo FOUND; echo "$hits"; fail=1; fi

label "Logs:"
hits=$(grep -rn "print(" backend/wikilens 2>/dev/null)
if [ -z "$hits" ]; then echo OK; else echo "$(echo "$hits" | wc -l | tr -d ' ') print() calls"; echo "$hits" | head; fi

if [ -f web/package.json ] && [ -d web/node_modules ]; then
  label "Web:"
  if out=$(cd web && pnpm -s exec tsc --noEmit 2>&1 && pnpm -s test 2>&1); then echo OK; else echo FAIL; echo "$out" | tail -25; fail=1; fi
fi

echo "--- git status"
git status --short | head -30
exit $fail

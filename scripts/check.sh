#!/bin/bash
# Every check: compile, types, lint, backend tests, browser unit tests, then the browser
# end-to-end tests. Needs the database from docker-compose.yml running.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/verify.sh

# The end-to-end tests start their own API (port 8001) and web server (port 5174).
for port in 8001 5174; do
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    echo "Port $port is in use; stop whatever holds it and run again."
    exit 1
  fi
done
(cd web && pnpm -s exec playwright test)

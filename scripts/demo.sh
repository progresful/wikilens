#!/bin/bash
# Start everything the demo needs and serve the app at http://127.0.0.1:8000
# Works without a network connection once the articles are loaded and embedded.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env file: copy .env.example to .env and set the two passwords."; exit 1; }
[ -x .venv/bin/python ] || { echo "No Python environment: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; exit 1; }

docker compose up -d --wait

if ! curl -sf -o /dev/null http://127.0.0.1:11434/api/version; then
  echo "Ollama is not running, so questions cannot be asked (scrubbing still works)."
  echo "Start it in another terminal with:  ollama serve"
fi

(cd web && pnpm install --frozen-lockfile --silent && pnpm -s build)

echo
echo "WikiLens is at http://127.0.0.1:8000   (Ctrl-C to stop)"
exec .venv/bin/python -m wikilens.api

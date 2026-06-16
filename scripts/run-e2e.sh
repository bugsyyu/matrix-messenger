#!/usr/bin/env bash
# Spin up a fresh server on an ephemeral port, run e2e + agent tests, then tear down.
set -euo pipefail

PORT="${PORT:-3007}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp -t mm-e2e.XXXXXX.log)"

echo "[e2e] starting server on :$PORT"
PORT="$PORT" node "$ROOT/server/src/index.mjs" > "$LOG" 2>&1 &
SPID=$!
trap 'kill "$SPID" 2>/dev/null || true; rm -f "$LOG"' EXIT

# wait for listen
for i in $(seq 1 20); do
  if ss -tln 2>/dev/null | grep -q ":$PORT "; then break; fi
  sleep 0.15
done

URL="ws://127.0.0.1:$PORT/ws"   node "$ROOT/server/src/e2e.test.mjs"
HTTP="http://127.0.0.1:$PORT"   node "$ROOT/server/src/agent.test.mjs"

echo "[e2e] all green"

#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
echo "=== ontology surface ==="
node test/ontology.test.mjs
echo
echo "=== channel happy path ==="
node test/channel.test.mjs
echo
echo "=== challenge defense ==="
node test/challenge.test.mjs
echo
echo "=== trust score ==="
node test/trust.test.mjs
echo
echo "=== fuzz harness (5000 rounds, seeded) ==="
node test/fuzz.test.mjs
echo
echo "ALL PAYMENT-PROTOCOL TESTS PASS"

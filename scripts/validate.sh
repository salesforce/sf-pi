#!/usr/bin/env bash
set -euo pipefail

echo "=== Generate catalog ==="
node scripts/generate-catalog.mjs

echo ""
echo "=== SPDX header check ==="
node scripts/add-spdx-headers.mjs --check

echo ""
echo "=== Format check ==="
npx prettier --check .

echo ""
echo "=== Type check ==="
npx tsc --noEmit -p tsconfig.json

echo ""
echo "=== Tests ==="
npx vitest run

echo ""
echo "=== All checks passed ==="

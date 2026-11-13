#!/usr/bin/env bash
set -euo pipefail

echo "=== WRM Phase 5 Verification ==="

echo "1. Building contracts..."
pnpm --filter @wrm/contracts build

echo "2. Generating Prisma client..."
pnpm --filter @wrm/api db:generate

echo "3. Deploying database migrations..."
pnpm --filter @wrm/api db:deploy

echo "4. Typecheck across monorepo..."
pnpm run typecheck

echo "5. Lint across monorepo..."
pnpm run lint

echo "6. Checking architecture boundaries (depcruise)..."
pnpm --filter @wrm/api depcruise

echo "7. Running full test suite..."
pnpm --filter @wrm/api test

echo "8. Checking git attribution..."
COAUTHORED_COUNT=$(git log main..HEAD --format=%B | grep -ci "co-authored" || true)
if [ "$COAUTHORED_COUNT" -gt 0 ]; then
  echo "ERROR: Found Co-Authored-By attribution in git commits!"
  exit 1
fi

echo "=== Phase 5 Verification PASSED ==="



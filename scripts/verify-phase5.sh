#!/usr/bin/env bash
set -e

echo "=== WRM Phase 5 Verification ==="

echo "1. Building contracts..."
pnpm --filter @wrm/contracts build

echo "2. Generating Prisma client..."
pnpm --filter @wrm/api db:generate

echo "3. Typecheck across monorepo..."
pnpm run typecheck

echo "4. Lint across monorepo..."
pnpm run lint

echo "5. Checking architecture boundaries (depcruise)..."
pnpm --filter @wrm/api depcruise

echo "6. Running Phase 5 unit & acceptance tests..."
pnpm --filter @wrm/api exec vitest run test/monitoring-rules.spec.ts test/phase5-acceptance.e2e.spec.ts

echo "7. Checking git attribution..."
COAUTHORED_COUNT=$(git log main..HEAD --format=%B | grep -ci "co-authored" || true)
if [ "$COAUTHORED_COUNT" -gt 0 ]; then
  echo "ERROR: Found Co-Authored-By attribution in git commits!"
  exit 1
fi

echo "=== Phase 5 Verification PASSED ==="

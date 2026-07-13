#!/bin/bash
set -e
cd /root/.hermes/kanban/boards/music-library/workspaces/t_8e211ca6

echo "=== Running Test 1: playlist context ==="
npx playwright test tests/e2e/player-queue.test.ts -g "playing from playlist" --reporter=list --timeout=60000 2>&1 || true

echo ""
echo "=== Running Test 7: sleep timer ==="
npx playwright test tests/e2e/player-queue.test.ts -g "sleep timer starts" --reporter=list --timeout=60000 2>&1 || true

echo ""
echo "=== Done ==="

#!/usr/bin/env bash
# Bundle size budget check for CI
# Measures gzip size of client JS assets
# Warns at BUNDLE_WARN_KB (default 600), errors at BUNDLE_ERROR_KB (default 800)
#
# Usage: bash scripts/check-bundle-size.sh [warn_kb] [error_kb]

set -euo pipefail

WARN_KB="${1:-600}"
ERROR_KB="${2:-800}"
CLIENT_ASSETS="build/client/assets"

if [ ! -d "$CLIENT_ASSETS" ]; then
  echo "::error::Client assets directory not found. Run 'npm run build' first."
  exit 1
fi

# Measure total gzip size of all JS files in client assets
TOTAL_GZIP=0
for f in "$CLIENT_ASSETS"/*.js; do
  size=$(gzip -c "$f" | wc -c)
  TOTAL_GZIP=$((TOTAL_GZIP + size))
done
TOTAL_KB=$((TOTAL_GZIP / 1024))

# Count chunks
CHUNK_COUNT=$(find "$CLIENT_ASSETS" -name "*.js" | wc -l)

# Get raw size for reference
RAW_SIZE=$(du -sb "$CLIENT_ASSETS" | awk '{print $1}')
RAW_KB=$((RAW_SIZE / 1024))

echo "📦 Bundle size report"
echo "  Chunks:       $CHUNK_COUNT"
echo "  Raw size:     ${RAW_KB}KB"
echo "  Gzip size:    ${TOTAL_KB}KB"
echo "  Warn limit:   ${WARN_KB}KB"
echo "  Error limit:  ${ERROR_KB}KB"

if [ "$TOTAL_KB" -gt "$ERROR_KB" ]; then
  echo "::error::Bundle gzip size ${TOTAL_KB}KB exceeds error limit of ${ERROR_KB}KB"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_size_kb=$TOTAL_KB" >> "$GITHUB_OUTPUT"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_status=error" >> "$GITHUB_OUTPUT"
  exit 1
elif [ "$TOTAL_KB" -gt "$WARN_KB" ]; then
  echo "::warning::Bundle gzip size ${TOTAL_KB}KB exceeds warning limit of ${WARN_KB}KB"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_size_kb=$TOTAL_KB" >> "$GITHUB_OUTPUT"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_status=warn" >> "$GITHUB_OUTPUT"
  exit 0
else
  echo "✅ Bundle size ${TOTAL_KB}KB is within budget (${ERROR_KB}KB)"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_size_kb=$TOTAL_KB" >> "$GITHUB_OUTPUT"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "bundle_status=ok" >> "$GITHUB_OUTPUT"
  exit 0
fi

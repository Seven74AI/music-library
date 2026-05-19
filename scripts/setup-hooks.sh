#!/bin/sh
# Setup git hooks for this repository
# Run once after cloning: sh scripts/setup-hooks.sh
git config core.hooksPath .githooks
echo "✓ Git hooks configured (core.hooksPath = .githooks)"
echo "  Pre-push hook: .githooks/pre-push"
echo "  To bypass in emergencies: git push --no-verify"

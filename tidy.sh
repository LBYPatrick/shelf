#!/bin/bash
# Format and lint-fix the codebase. Installs the toolchain if it is missing.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

SKIP_CHECK=0
[[ "${1:-}" == "--skip-check" ]] && SKIP_CHECK=1

if [[ "$SKIP_CHECK" -eq 0 ]]; then
    if ! pnpm exec prettier --version &>/dev/null; then
        echo "Formatter not found, installing..."
        bash scripts/install-formatter.sh
    fi
fi

echo "==> prettier"
pnpm exec prettier --write "src/**/*.{ts,vue,css}" "tests/**/*.ts" "*.{ts,js,json}" 2>/dev/null || \
    pnpm exec prettier --write "src/**/*.{ts,vue,css}"

echo "==> oxlint"
pnpm exec oxlint --fix

echo "Done."

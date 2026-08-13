#!/bin/bash
# Remove build artifacts and caches. Safe to run at any time.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

for target in out dist release coverage test-results playwright-report node_modules/.vite; do
    if [[ -e "$target" ]]; then
        rm -rf "$target"
        echo "removed $target"
    fi
done

echo "Clean."

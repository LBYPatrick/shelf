#!/bin/bash
# Remove dependencies, build output and caches.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash scripts/clean.sh

for target in node_modules pnpm-lock.yaml; do
    if [[ -e "$target" ]]; then
        rm -rf "$target"
        echo "removed $target"
    fi
done

echo "Uninstalled. Run 'make install' to set up again."

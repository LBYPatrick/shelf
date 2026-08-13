#!/bin/bash
# Install the formatter and linter toolchain.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v pnpm &>/dev/null; then
    echo "pnpm not found, installing"
    if command -v corepack &>/dev/null; then
        corepack enable && corepack prepare pnpm@latest --activate
    else
        npm install -g pnpm
    fi
fi

pnpm add -D prettier eslint typescript-eslint eslint-plugin-vue @eslint/js globals

echo "Formatter installed."

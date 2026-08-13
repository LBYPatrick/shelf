#!/bin/bash
# Install everything Shelf needs to run from source.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
done_() { echo -e "${GREEN}✓${NC} $1"; }

step "Checking system dependencies"
bash scripts/ensure_deps.sh

step "Installing packages"
if [[ "${VERBOSE:-0}" == "1" ]]; then
    pnpm install
else
    pnpm install --reporter=append-only
fi
done_ "packages installed"

step "Verifying native modules"
# better-sqlite3 is rebuilt against the Electron ABI by the postinstall hook.
if node -e "require.resolve('better-sqlite3')" &>/dev/null; then
    done_ "better-sqlite3 present"
else
    echo "better-sqlite3 missing — run: pnpm exec electron-rebuild --only better-sqlite3"
    exit 1
fi

echo ""
done_ "Shelf is ready. Run 'make dev' to start."

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

step "Verifying Electron"
# Every UI and end-to-end test launches Electron, and nothing until now checked
# that it *can* launch.
#
# Its framework is a 200MB download the package extracts, and a truncated one
# extracts without complaint. The first launch then fails with
#
#   dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
#   Reason: segment '__TEXT' load command content extends beyond end of file
#
# which Playwright reports as "Process failed to launch!" on every test that
# opens a window — through both retries, because a corrupt file does not heal by
# being opened again. It cost a red gate on `main` that read as flakiness.
#
# `--version` is the cheap way to ask, because it loads the framework rather
# than just looking for the file: a second, against twenty minutes of tests.
electron_works() { pnpm exec electron --version >/dev/null 2>&1; }

if electron_works; then
    done_ "electron $(pnpm exec electron --version 2>/dev/null)"
else
    echo "  Electron will not start. Its framework is usually a truncated download,"
    echo "  so the download is what gets thrown away rather than the install."
    rm -rf node_modules/electron/dist
    rm -rf "${ELECTRON_CACHE:-$HOME/Library/Caches/electron}"
    pnpm rebuild electron >/dev/null 2>&1 || true

    if electron_works; then
        done_ "electron $(pnpm exec electron --version 2>/dev/null) (after re-downloading it)"
    else
        echo ""
        echo "  Electron still will not start after a clean download."
        echo "  Run 'pnpm exec electron --version' to see what it says."
        exit 1
    fi
fi

echo ""
done_ "Shelf is ready. Run 'make dev' to start."

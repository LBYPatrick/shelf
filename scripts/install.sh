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
#
# The error is kept rather than thrown away. It used to go to /dev/null and the
# advice was "run it yourself to see what it says", which is no advice at all on
# a machine nobody is sitting at — a CI runner cannot run it yourself.
electron_says=""
electron_works() { electron_says="$(pnpm exec electron --version 2>&1)"; }

# Where the downloaded archive is cached, per platform.
#
# This was `$HOME/Library/Caches/electron` unconditionally, which is macOS's
# path — so on Linux and Windows the "clean download" below deleted nothing and
# re-extracted the same archive. That made the retry a no-op there, and with it
# the conclusion drawn from a second failure.
electron_cache() {
    if [[ -n "${ELECTRON_CACHE:-}" ]]; then echo "$ELECTRON_CACHE"; return; fi
    case "$(uname -s)" in
        Darwin) echo "$HOME/Library/Caches/electron" ;;
        MINGW* | MSYS* | CYGWIN*) echo "${LOCALAPPDATA:-$HOME/AppData/Local}/electron/Cache" ;;
        *) echo "${XDG_CACHE_HOME:-$HOME/.cache}/electron" ;;
    esac
}

if electron_works; then
    done_ "electron $electron_says"
else
    echo "  Electron will not start. Its framework is usually a truncated download,"
    echo "  so the download is what gets thrown away rather than the install."
    echo ""
    echo "$electron_says" | sed 's/^/    /'
    rm -rf node_modules/electron/dist
    rm -rf "$(electron_cache)"
    pnpm rebuild electron >/dev/null 2>&1 || true

    if electron_works; then
        done_ "electron $electron_says (after re-downloading it)"
    else
        # A clean download that still will not start is not a download problem.
        #
        # That is the whole of the distinction, and it needs no message-parsing
        # to draw: this check exists to catch a *truncated* framework, and it
        # has just replaced the framework. What is left is a fact about the
        # machine — on Linux, almost always the shared libraries Electron links
        # against, which a bare CI image does not carry.
        #
        # So it says so and gets out of the way. Failing here stopped a release
        # on the Linux packaging runner, which never launches Electron at all:
        # it unpacks one and repackages it. A check that cannot tell "this build
        # is broken" from "this machine has no GUI libraries" must not be the
        # thing that decides whether an install succeeded.
        echo ""
        echo "  A clean download will not start either, so this is the machine"
        echo "  rather than the download — usually libraries Electron links"
        echo "  against. Packaging does not need them; running the app does."
        echo ""
        echo "$electron_says" | sed 's/^/    /'
        echo ""
        echo "  Continuing. 'make dev' and the tests will not work until this is"
        echo "  fixed; 'make package' will."
    fi
fi

echo ""
done_ "Shelf is ready. Run 'make dev' to start."

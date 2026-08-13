#!/bin/bash
# Verify the system tools Shelf needs, installing what is missing where possible.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ok${NC}   $1"; }
warn() { echo -e "${YELLOW}  warn${NC} $1"; }
fail() { echo -e "${RED}  fail${NC} $1"; }

OS="$(uname -s)"

require_node() {
    if ! command -v node &>/dev/null; then
        fail "node is not installed. Install Node.js 20 or newer: https://nodejs.org"
        exit 1
    fi
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -lt 20 ]]; then
        fail "node $major is too old; Shelf needs Node 20 or newer"
        exit 1
    fi
    ok "node $(node -v)"
}

require_pnpm() {
    if command -v pnpm &>/dev/null; then
        ok "pnpm $(pnpm -v)"
        return
    fi
    warn "pnpm not found, installing via corepack"
    if command -v corepack &>/dev/null; then
        corepack enable && corepack prepare pnpm@latest --activate
    else
        npm install -g pnpm
    fi
    ok "pnpm $(pnpm -v)"
}

check_build_tools() {
    # Only better-sqlite3 is compiled from source, and only when no prebuilt
    # binary matches the local Electron ABI.
    case "$OS" in
        Darwin)
            if xcode-select -p &>/dev/null; then
                ok "xcode command line tools"
            else
                warn "xcode command line tools missing; run: xcode-select --install"
            fi
            ;;
        Linux)
            if command -v cc &>/dev/null && command -v python3 &>/dev/null; then
                ok "c toolchain and python3"
            else
                warn "install build tools: apt install build-essential python3 (or the equivalent)"
            fi
            ;;
        *)
            warn "unrecognised OS '$OS'; native rebuilds may need manual setup"
            ;;
    esac
}

echo "Checking system dependencies..."
require_node
require_pnpm
check_build_tools

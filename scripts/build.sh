#!/bin/bash
#
# Type-check and build all three processes.
#
# The icon copy belongs to building rather than sitting beside it. The renderer
# imports `assets/icon.svg` and cannot reach outside its own build root, so the
# drawing is copied in from `resources/` — and a build that skips the copy fails
# on a checkout that has never had one, which is every CI run. Make had that
# rule and make is not dependable on a Windows runner; a script is.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p src/renderer/assets
cp resources/icon.svg src/renderer/assets/icon.svg

pnpm typecheck
pnpm build

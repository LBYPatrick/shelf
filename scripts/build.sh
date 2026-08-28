#!/bin/bash
#
# Type-check and build all three processes.
#
# `pnpm typecheck` used to be `vue-tsc -p tsconfig.json`, and tsconfig.json is a
# solution file: `"files": []` plus two references. Without `--build`, that
# checks the files listed in *that* project, which is none of them — the gate
# ran a type-checker over zero files in a third of a second and reported
# success. It shipped `input is not defined` in the assistant's schema tool,
# which is a plain `ReferenceError` any typecheck would have caught, and which
# reached a person as "Could not read the schema" in a chat.
#
# It now checks `tsconfig.node.json` — main, preload, the host, the drivers, the
# assistant and the shared code — which is where that bug was and where this
# class of bug lands, because none of it is exercised by a browser bundle that
# would have complained. The renderer project is not in yet: it fails with
# eighty-odd errors of its own, most of them prop-shape complaints in stories
# and templates, and turning that green is its own change rather than a line in
# this one.
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

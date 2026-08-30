#!/bin/bash
#
# The renderer's `.vue` files, checked for names that do not exist.
#
# `pnpm typecheck` runs `tsc` over the node side only — main, the utility
# process and shared — and `electron-vite build` transpiles the renderer without
# checking it. So a `.vue` script block calling a function nobody imported
# builds, passes the gate, ships, and throws the first time that line runs. That
# happened: `errorMessage` was used in `ConnectionManager.vue` with no import,
# and every check in the repository was green.
#
# The whole-project `vue-tsc` run reports eighty-odd other errors — Tabulator
# ships no types, several stories are typed loosely, a few prop shapes disagree
# — and fixing those is its own piece of work. So this is a floor rather than a
# ceiling: it fails only on names that do not resolve, which is the class that
# turns into a crash rather than a wrong type. Tighten it by deleting codes from
# the list once the rest is clean.
#
# Outside `make gate` on purpose. It takes about half a minute, and the gate's
# forty seconds is the reason the gate gets run.
set -euo pipefail

CODES='TS2304|TS2552|TS2307'   # cannot find name / did you mean / cannot find module

report="$(pnpm exec vue-tsc --noEmit -p tsconfig.web.json 2>&1 || true)"
found="$(printf '%s\n' "$report" | grep -E "src/renderer/.*error (${CODES})" || true)"

if [[ -n "$found" ]]; then
  echo ""
  echo "  A name in the renderer does not resolve:"
  echo ""
  printf '%s\n' "$found" | sed 's/^/    /'
  echo ""
  exit 1
fi

echo "renderer names: all resolve"

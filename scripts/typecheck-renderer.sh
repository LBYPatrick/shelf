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
# In `make gate`, and it was not. It was left out on the grounds that it took
# about half a minute and the gate's forty seconds is the reason the gate gets
# run — but measured rather than remembered it is three seconds cold and under
# two warm, which buys the whole class for nothing.
#
# It was left out and the class came straight back: `formatDuration` was used in
# `QueryTab.vue` with no import, and lint, the unit suite, `tsc`, the build, the
# UI gate and the end-to-end suite were every one of them green. It surfaced as
# a `ReferenceError` in a browser console, which is precisely the report this
# exists to replace.
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

#!/bin/bash
#
# Builds distributables with electron-builder.
#
# Platforms are named the way people say them — macos, linux, windows — and
# translated here into the flags the packager takes, because `--mac` is a thing
# you have to look up and `macos` is not.
#
# One run for all of the requested platforms rather than one per platform:
# electron-builder accepts several and shares the unpacked Electron between
# them, so asking for two costs far less than asking twice.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/signing.sh
source "scripts/signing.sh"

readonly REQUESTED="${1:-}"
readonly CONFIG="electron-builder.config.cjs"

host_platform() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    MINGW* | MSYS* | CYGWIN*) echo windows ;;
    *)
      echo "unsupported host: $(uname -s)" >&2
      return 1
      ;;
  esac
}

# The default is the machine this is running on. Cross-packaging is something
# you ask for, not something you get by accident.
platforms="${REQUESTED:-$(host_platform)}"

flag_for() {
  case "$1" in
    macos | mac | osx | darwin) echo --mac ;;
    linux) echo --linux ;;
    windows | win | win32) echo --win ;;
    *)
      echo "unknown platform '$1' — expected macos, linux or windows" >&2
      return 1
      ;;
  esac
}

flags=()
wanted=()

IFS=',' read -ra names <<<"$platforms"
for name in "${names[@]}"; do
  name="$(echo "$name" | tr -d '[:space:]')"
  [[ -z "$name" ]] && continue

  flags+=("$(flag_for "$name")")
  wanted+=("$name")
done

if [[ ${#flags[@]} -eq 0 ]]; then
  echo "no platforms given" >&2
  exit 1
fi

# What a Linux build needs from the machine it is built on. The .deb and .rpm
# are what carry the desktop entry — the file that puts the app in GNOME's
# drawer — and each is assembled by the host's own packaging tools.
if [[ " ${wanted[*]} " == *" linux "* ]] && [[ "$(uname -s)" == Darwin ]]; then
  missing=()
  command -v dpkg >/dev/null || missing+=(dpkg)
  command -v rpmbuild >/dev/null || missing+=(rpm)

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    echo "  Building Linux packages on macOS needs: ${missing[*]}"
    echo "  Without them the .deb and .rpm cannot be assembled — and those are"
    echo "  what install the desktop entry, which is how GNOME lists the app."
    echo "  Install with: brew install ${missing[*]}"
    echo ""
    exit 1
  fi
fi

# Signing is opt-in and asked for by name.
#
# Saying "do not harden and do not notarise" is not the same as saying "do not
# sign": left alone the packager searches every keychain on the machine's search
# list and signs with whatever it finds — which is how a build of this app once
# reached for a certificate belonging to another project, out of a keychain that
# was on the list for reasons of its own. `SIGN=1` starts the conversation about
# which certificate to use; anything else signs nothing.
if signing_truthy "${SIGN:-}"; then
  signing_setup
fi

if [[ -z "${APPLE_IDENTITY:-}" && -z "${APPLE_TEAM_ID:-}" ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

# Architectures, when more than the one under you is wanted. Empty means the
# machine's own, which is what a build you are about to run yourself should be.
arch_flags=()
if [[ -n "${ARCH:-}" ]]; then
  IFS=',' read -ra arches <<<"$ARCH"
  for a in "${arches[@]}"; do
    a="$(echo "$a" | tr -d '[:space:]')"
    [[ -z "$a" ]] && continue
    arch_flags+=("--$a")
  done
fi

echo "==> Packaging for: ${wanted[*]}${ARCH:+ ($ARCH)}"
pnpm exec electron-builder --config "$CONFIG" "${flags[@]}" ${arch_flags[@]+"${arch_flags[@]}"}

# What the packager produced, checked rather than assumed.
#
# Both of these shipped in 1.0.0 and neither was catchable by the gate: the
# tests run against `out/`, where `node_modules` is on disk and nothing is
# signed, so a packaging mistake is invisible until somebody downloads the
# result. These are the two that got out.
version="$(node -p "require('./package.json').version")"
readonly OUT="release/$version"

fail=0

# The SQLite driver's binary. `files` excluded the directory it lives in, and
# the app shipped a driver that threw on require.
while IFS= read -r app; do
  if ! find "$app" -path '*better-sqlite3*' -name '*.node' | grep -q .; then
    echo "  MISSING: no better-sqlite3 binary in $app" >&2
    fail=1
  fi
done < <(find "$OUT" -maxdepth 2 -name '*.app' -o -maxdepth 2 -name 'linux-*' -type d 2>/dev/null)

# And the signature. Unsigned, a downloaded .app is refused as "damaged".
if [[ "$(uname -s)" == Darwin ]]; then
  while IFS= read -r app; do
    if ! codesign --verify --strict "$app" 2>/dev/null; then
      echo "  UNSIGNED: $app would be refused as damaged once downloaded" >&2
      fail=1
    fi
  done < <(find "$OUT" -maxdepth 2 -name '*.app' 2>/dev/null)
fi

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "  The packages are broken. See the notes in electron-builder.config.cjs." >&2
  echo "" >&2
  exit 1
fi

echo ""
echo "Distributables are in ./release"

#!/bin/bash
#
# Setting up macOS code signing, interactively, once.
#
# Signing is asked for by name here and never discovered. Left to itself the
# packager searches every keychain on the machine's search list and signs with
# whatever it finds first — which is how a build of this app reached for a
# certificate belonging to a different project, from a keychain that was on the
# list for reasons of its own. A build signs with the certificate you chose, or
# it does not sign.
#
# What is chosen is written to a file that git does not track, because it names
# a certificate on this machine and belongs to this machine.

readonly SIGNING_FILE=".signing.local"

# Where `notarytool store-credentials` keeps what it is given, so an existing
# profile can be recognised without a network call.
readonly NOTARY_SERVICE="com.apple.gke.notary.tool"

signing_truthy() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | y | on) return 0 ;;
    *) return 1 ;;
  esac
}

# The kind of certificate decides what the build is good for, and the names are
# close enough to each other to be worth spelling out at the moment of choosing.
signing_purpose() {
  case "$1" in
    "Developer ID Application"*) echo "apps distributed outside the App Store — what this app needs" ;;
    "Developer ID Installer"*) echo "installer packages (.pkg), not apps" ;;
    "Apple Distribution"*) echo "App Store and TestFlight only; Gatekeeper rejects a download signed with it" ;;
    "Apple Development"*) echo "running locally while developing; not for distribution" ;;
    "Mac Developer"*) echo "running locally while developing; not for distribution" ;;
    *) echo "unrecognised kind — check what it is for before shipping with it" ;;
  esac
}

# The team the certificate belongs to is the last parenthesised field of its
# name, which is also what notarisation wants told to it.
signing_team_of() {
  echo "$1" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p'
}

# A certificate the keychain will not actually sign with is worth finding out
# about in a second, rather than four minutes into packaging. This is exactly
# what `errSecInternalComponent` looks like when the private key is there but
# its access control says no.
signing_verify() {
  local identity="$1" scratch
  scratch="$(mktemp -d)/probe"
  printf 'probe' >"$scratch"

  if codesign --sign "$identity" --force "$scratch" >/dev/null 2>&1; then
    rm -rf "$(dirname "$scratch")"
    return 0
  fi

  echo ""
  echo "  That certificate is present but would not sign a test file."
  echo "  Usually its keychain is locked, or the private key's access control"
  echo "  does not allow codesign to use it without being asked each time."
  echo "  Open Keychain Access, find the private key, and under Access Control"
  echo "  allow 'codesign' — or 'Allow all applications to access this item'."
  echo ""
  rm -rf "$(dirname "$scratch")"
  return 1
}

signing_choose_identity() {
  local -a names=()
  local line name

  while IFS= read -r line; do
    name="$(echo "$line" | sed -n 's/.*"\(.*\)"$/\1/p')"
    [[ -n "$name" ]] && names+=("$name")
  done < <(security find-identity -v -p codesigning 2>/dev/null | grep '"')

  if [[ ${#names[@]} -eq 0 ]]; then
    echo "No code-signing certificates were found on this machine." >&2
    echo "" >&2
    echo "A downloadable Mac app needs a 'Developer ID Application' certificate," >&2
    echo "which comes from an Apple Developer Program membership: create it at" >&2
    echo "https://developer.apple.com/account/resources/certificates — or in" >&2
    echo "Xcode under Settings › Accounts › Manage Certificates." >&2
    return 1
  fi

  echo "" >&2
  echo "Certificates this machine can sign with:" >&2
  echo "" >&2
  local index=1
  for name in "${names[@]}"; do
    printf '  %d) %s\n' "$index" "$name" >&2
    printf '     %s\n' "$(signing_purpose "$name")" >&2
    index=$((index + 1))
  done
  echo "" >&2

  # Never a default, and never a silent pick when there is only one: choosing a
  # certificate is the whole point of asking.
  local choice=""
  while true; do
    read -r -p "Sign with which? [1-${#names[@]}, or q to cancel] " choice
    [[ "$choice" == q || "$choice" == Q ]] && return 1
    if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#names[@]})); then
      break
    fi
    echo "  Enter a number between 1 and ${#names[@]}." >&2
  done

  echo "${names[$((choice - 1))]}"
}

signing_choose_notarisation() {
  local answer profile

  echo "" >&2
  echo "Notarisation sends the signed app to Apple to be checked, and is what" >&2
  echo "stops macOS warning the person who downloads it. It needs an Apple ID" >&2
  echo "and an app-specific password, kept by notarytool in your keychain." >&2
  read -r -p "Notarise builds? [y/N] " answer

  signing_truthy "$answer" || return 0

  read -r -p "  notarytool profile name [shelf]: " profile
  profile="${profile:-shelf}"

  if ! security find-generic-password -s "$NOTARY_SERVICE" -a "$profile" >/dev/null 2>&1; then
    echo "" >&2
    echo "  No profile called '$profile' yet. Creating one now — notarytool will" >&2
    echo "  ask for your Apple ID and an app-specific password, which you make at" >&2
    echo "  https://account.apple.com under Sign-In and Security." >&2
    echo "" >&2
    if ! xcrun notarytool store-credentials "$profile" >&2; then
      echo "  Skipping notarisation; builds will be signed but not notarised." >&2
      return 0
    fi
  fi

  echo "$profile"
}

# Asks once, remembers, and can be asked again with RECONFIGURE=1.
signing_setup() {
  if [[ "$(uname -s)" != Darwin ]]; then
    echo "SIGN is a macOS thing; ignoring it on $(uname -s)." >&2
    return 0
  fi

  if [[ -f "$SIGNING_FILE" ]] && ! signing_truthy "${RECONFIGURE:-}"; then
    # shellcheck source=/dev/null
    source "$SIGNING_FILE"
    export APPLE_IDENTITY APPLE_TEAM_ID
    [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]] && export APPLE_KEYCHAIN_PROFILE
    echo "==> Signing as: ${APPLE_IDENTITY}"
    echo "    (from $SIGNING_FILE — re-run with RECONFIGURE=1 to change it)"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "SIGN is set, but there is no terminal to ask questions on." >&2
    echo "Set APPLE_IDENTITY and APPLE_TEAM_ID in the environment instead." >&2
    return 1
  fi

  local identity team profile
  identity="$(signing_choose_identity)" || return 1
  signing_verify "$identity" || return 1

  team="$(signing_team_of "$identity")"
  if [[ -z "$team" ]]; then
    read -r -p "Team ID (10 characters, from developer.apple.com): " team
  fi

  profile="$(signing_choose_notarisation)"

  {
    echo "# Written by scripts/signing.sh. Not tracked by git: it names a"
    echo "# certificate on this machine and is nobody else's business."
    echo "APPLE_IDENTITY='$identity'"
    echo "APPLE_TEAM_ID='$team'"
    [[ -n "$profile" ]] && echo "APPLE_KEYCHAIN_PROFILE='$profile'"
  } >"$SIGNING_FILE"

  export APPLE_IDENTITY="$identity"
  export APPLE_TEAM_ID="$team"
  [[ -n "$profile" ]] && export APPLE_KEYCHAIN_PROFILE="$profile"

  echo ""
  echo "==> Signing as: $identity"
  echo "    Team $team${profile:+, notarising with profile '$profile'}"
  echo "    Remembered in $SIGNING_FILE"
}

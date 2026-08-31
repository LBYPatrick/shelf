#!/bin/bash
#
# Hands a CI runner the certificate and the notarisation key, when the run has
# them.
#
# `scripts/signing.sh` is the other half of this and cannot do the job here: it
# picks a certificate out of the login keychain by asking a person which one,
# and a runner has neither a login keychain with a certificate in it nor a
# person to ask. So the two arrive as secrets instead — the certificate as a
# base64 `.p12`, the notarisation credentials as an App Store Connect API key —
# and this writes the environment electron-builder reads for each.
#
# Signing stays opt-in for the same reason it is opt-in on a laptop: a fork, or
# a repository nobody has given a certificate to, has these secrets empty, and
# an empty secret has to mean "unsigned build" rather than "fail at the end of a
# forty-minute run". Every check below is a way of saying that.
#
# Nothing is written to disk that outlives the runner. `RUNNER_TEMP` is wiped
# with the machine, and the machine is destroyed when the job ends.
set -euo pipefail

cd "$(dirname "$0")/.."

# The certificate is a macOS one and so is everything below it.
if [[ "$(uname -s)" != Darwin ]]; then
  exit 0
fi

if [[ -z "${GITHUB_ENV:-}" ]]; then
  echo "This is for a GitHub Actions runner; GITHUB_ENV is not set." >&2
  echo "To sign on your own machine, run 'make package SIGN=1' instead." >&2
  exit 1
fi

# A base64 blob pasted into the secrets UI may or may not have been wrapped by
# whichever `base64` produced it, and `GITHUB_ENV` is line-oriented.
one_line() {
  printf '%s' "${1:-}" | tr -d '[:space:]'
}

readonly CERTIFICATE="$(one_line "${APPLE_CERTIFICATE_P12:-}")"
readonly API_KEY="$(one_line "${APPLE_API_KEY_P8:-}")"

if [[ -z "$CERTIFICATE" ]]; then
  echo "==> No signing certificate in this run; the mac build will be unsigned."
  echo "    Set APPLE_CERTIFICATE_P12 and APPLE_CERTIFICATE_PASSWORD to sign."
  exit 0
fi

# Half a set of credentials is the failure worth catching early: the packager
# reaches for the password four minutes in, and finds an empty string.
if [[ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  echo "APPLE_CERTIFICATE_P12 is set but APPLE_CERTIFICATE_PASSWORD is not." >&2
  echo "It is the password given when the .p12 was exported, and a .p12 with" >&2
  echo "no password cannot be imported by electron-builder." >&2
  exit 1
fi

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "APPLE_CERTIFICATE_P12 is set but APPLE_TEAM_ID is not." >&2
  echo "It is the ten characters in brackets at the end of the certificate's" >&2
  echo "name, and it is what turns on the hardened runtime — without which a" >&2
  echo "signed app is still refused by notarisation." >&2
  exit 1
fi

# `CSC_LINK` takes the base64 of the .p12 directly, so the certificate never
# becomes a file: electron-builder imports it into a keychain of its own making
# and throws that away with the run.
{
  echo "CSC_LINK=$CERTIFICATE"
  echo "CSC_KEY_PASSWORD=$APPLE_CERTIFICATE_PASSWORD"
  echo "APPLE_TEAM_ID=$APPLE_TEAM_ID"
} >>"$GITHUB_ENV"

echo "==> Signing as team $APPLE_TEAM_ID"

# Notarisation, separately, because a signed build that is not notarised is
# still a better build than an unsigned one — macOS warns about it rather than
# refusing it as damaged. So a missing key is a note, not a failure.
if [[ -z "$API_KEY" ]]; then
  echo "    Not notarising: no APPLE_API_KEY_P8 in this run."
  exit 0
fi

if [[ -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
  echo "APPLE_API_KEY_P8 is set but APPLE_API_KEY_ID or APPLE_API_ISSUER is not." >&2
  echo "All three come from the same row of App Store Connect › Users and" >&2
  echo "Access › Integrations › Keys: the key file, its Key ID, and the Issuer" >&2
  echo "ID above the table." >&2
  exit 1
fi

# The one thing that does have to be a file: `notarytool` is given a path to the
# key, not its bytes.
readonly KEY_FILE="${RUNNER_TEMP:-/tmp}/asc-api-key.p8"
printf '%s' "$API_KEY" | base64 --decode >"$KEY_FILE"
chmod 600 "$KEY_FILE"

# A .p8 that did not survive the round trip through a secret fails at the very
# end of the build, after everything has been signed and packaged.
if ! grep -q 'BEGIN PRIVATE KEY' "$KEY_FILE"; then
  echo "APPLE_API_KEY_P8 did not decode to a private key." >&2
  echo "It should be the base64 of the .p8 file downloaded from App Store" >&2
  echo "Connect: base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\\n'" >&2
  exit 1
fi

{
  echo "APPLE_API_KEY=$KEY_FILE"
  echo "APPLE_API_KEY_ID=$APPLE_API_KEY_ID"
  echo "APPLE_API_ISSUER=$APPLE_API_ISSUER"
} >>"$GITHUB_ENV"

echo "    Notarising with App Store Connect key $APPLE_API_KEY_ID"

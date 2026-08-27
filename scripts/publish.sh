#!/bin/bash
#
# Publish a release, interactively or unattended.
#
# The number lives in `VERSION` — that is the file the Makefile prints, the file
# the build compiles in, and the file a person edits. `package.json` holds it a
# second time because electron-builder writes *that* one into every filename,
# and a manifest without a version is not a manifest. So the two are kept in
# step here rather than by remembering: VERSION is the answer and the manifest
# is brought to it.
#
# Everything that leaves this machine happens after one confirmation, and
# nothing before that point is irreversible.
#
#   V=1.2.0            the version to publish; asked for if a terminal is here
#   NOTES=notes.json    {"title": "...", "body": "..."} for the release page
#   YES=1               do not ask; for an agent, or for CI
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

readonly BRANCH="main"
readonly REMOTE="origin"

readonly WANTED="${V:-}"
readonly NOTES_FILE="${NOTES:-}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
step() { echo -e "\n${BLUE}==>${NC} $1"; }
note() { echo -e "    $1"; }
warn() { echo -e "${YELLOW}    $1${NC}"; }

die() {
  echo "" >&2
  echo "  $1" >&2
  echo "" >&2
  exit 1
}

truthy() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | y | on) return 0 ;;
    *) return 1 ;;
  esac
}

interactive() { [[ -t 0 ]]; }

manifest_version() { node -p "require('./package.json').version"; }
file_version() { tr -d '[:space:]' < VERSION; }

# Rewritten through the JSON parser rather than with a regular expression: the
# manifest is prettier's to format, and the gate below checks it — a hand-rolled
# edit that dropped the trailing newline would fail there rather than ship.
write_manifest_version() {
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
    manifest.version = process.argv[1];
    fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
  ' "$1"
}

# ---------------------------------------------------------------- preconditions

git rev-parse --git-dir &>/dev/null || die "Not a git repository."

current="$(git rev-parse --abbrev-ref HEAD)"
[[ "$current" == "$BRANCH" ]] ||
  die "publish runs from $BRANCH, and this is $current."

# The version files are the two this script is allowed to find already edited —
# editing VERSION and then running publish is the expected way round. Anything
# else uncommitted would ride along in the release commit unannounced.
stray="$(git status --porcelain | grep -Ev '^.. (VERSION|package\.json)$' || true)"
if [[ -n "$stray" ]]; then
  echo "" >&2
  echo "  Uncommitted changes other than the version files:" >&2
  echo "" >&2
  echo "$stray" >&2
  echo "" >&2
  echo "  Commit or stash them — a release commit carries the version and" >&2
  echo "  nothing else." >&2
  echo "" >&2
  exit 1
fi

# ----------------------------------------------------------------------- notes
#
# The title and the body are read and checked here, before the gate, because a
# malformed notes file is worth hearing about in the first second rather than
# the forty-first. The body goes to a file because release notes are prose with
# newlines in them, and `--notes-file` is how `gh` takes prose.

notes_title=""
notes_body=""

if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || die "No notes file at '$NOTES_FILE'."

  command -v gh >/dev/null ||
    die "NOTES needs the GitHub CLI to write the release page: brew install gh"

  notes_body="$(mktemp)"
  trap 'rm -f "$notes_body"' EXIT

  notes_title="$(node -e '
    const fs = require("node:fs");
    const path = process.argv[1];

    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path, "utf8"));
    } catch (error) {
      console.error(`${path} is not valid JSON: ${error.message}`);
      process.exit(1);
    }

    const body = typeof doc.body === "string" ? doc.body.trim() : "";
    if (!body) {
      console.error(`${path} has no "body". Expected {"title": "...", "body": "..."}.`);
      process.exit(1);
    }

    fs.writeFileSync(process.argv[2], body + "\n");
    process.stdout.write(typeof doc.title === "string" ? doc.title.trim() : "");
  ' "$NOTES_FILE" "$notes_body")"
fi

step "Fetching $REMOTE"
git fetch --quiet --tags "$REMOTE"

# Publishing a commit that is behind the remote pushes a branch somebody else
# has moved on from, and rebasing under a release is not this script's business.
if git rev-parse -q --verify "$REMOTE/$BRANCH" >/dev/null; then
  behind="$(git rev-list --count "HEAD..$REMOTE/$BRANCH")"
  [[ "$behind" -eq 0 ]] ||
    die "$BRANCH is $behind commit(s) behind $REMOTE. Pull first."
fi

# ---------------------------------------------------------------------- version

step "Version"
from_file="$(file_version)"
from_manifest="$(manifest_version)"

note "VERSION       $from_file"
note "package.json  $from_manifest"

if [[ "$from_file" != "$from_manifest" ]]; then
  warn "They disagree. VERSION is the answer; the manifest will be brought to it."
fi

if [[ -n "$WANTED" ]]; then
  chosen="$WANTED"
elif interactive; then
  echo ""
  read -r -p "  Version to publish [$from_file]: " chosen
  chosen="${chosen:-$from_file}"
else
  chosen="$from_file"
fi
chosen="$(echo "$chosen" | tr -d '[:space:]')"

# The shape electron-builder writes into filenames, and the shape the release
# workflow checks the tag against: three numbers, and no leading `v`.
[[ "$chosen" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  die "'$chosen' is not a three-part version. Try 1.2.0."

readonly TAG="v$chosen"

# The fetch above brought every remote tag down, so this one check answers for
# both this machine and the remote.
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null &&
  die "$TAG already exists. A released version is not cut again — bump instead."

[[ "$chosen" == "$from_file" ]] || echo "$chosen" > VERSION
[[ "$chosen" == "$from_manifest" ]] || write_manifest_version "$chosen"

if git diff --quiet -- VERSION package.json; then
  note "Both already say $chosen; there is nothing to write."
else
  note "Set to $chosen in VERSION and package.json."
fi

# A release page wants a name. Without one given, the tag is the name — which is
# what GitHub does by itself and reads as deliberate, where "Untitled" does not.
[[ -n "$NOTES_FILE" && -z "$notes_title" ]] && notes_title="Shelf $chosen"

# ------------------------------------------------------------------------- gate

# The release workflow deliberately does not run the gate: the commit a tag
# points at is supposed to have passed it already, and two of its three runners
# could not pass it anyway — the visual snapshots are pixels, and pixels are a
# function of the font rasteriser. This is where "already" happens.
step "Gate"
make gate

# ---------------------------------------------------------------------- confirm

step "Ready"
note "branch   $BRANCH -> $REMOTE"
note "tag      $TAG -> $REMOTE"

if git diff --quiet -- VERSION package.json; then
  note "commit   nothing to commit; $(git rev-parse --short HEAD) is what gets tagged"
else
  note "commit   chore(release): $chosen"
fi

if [[ -n "$NOTES_FILE" ]]; then
  note "notes    $notes_title  ($(wc -l < "$notes_body" | tr -d ' ') lines, from $NOTES_FILE)"
else
  note "notes    written by GitHub from the commits"
fi

if ! truthy "${YES:-}"; then
  interactive ||
    die "There is no terminal to confirm on. Pass YES=1 to publish unattended."

  echo ""
  echo "  Pushing the tag starts the packaging run and puts files on a page"
  echo "  other people download. Nothing has left this machine yet."
  echo ""
  read -r -p "  Publish $TAG? [y/N] " answer
  truthy "$answer" ||
    die "Stopped. The version files are written; nothing was committed."
fi

# ---------------------------------------------------------------------- publish

if ! git diff --quiet -- VERSION package.json; then
  step "Committing"
  git add VERSION package.json
  git commit -m "chore(release): $chosen"
fi

step "Pushing $BRANCH"
git push "$REMOTE" "$BRANCH"

# Tagged after the branch is pushed, so the commit the tag names is already on
# the remote when the workflow goes looking for it.
step "Tagging $TAG"
git tag -a "$TAG" -m "chore(release): $chosen"
git push "$REMOTE" "$TAG"

# The release is drafted here and made live by the workflow once the packages
# are attached, so nobody arrives at an empty page during the forty minutes it
# takes to build them. Without notes there is nothing to say yet, and the
# workflow writes the page itself from the commits.
if [[ -n "$NOTES_FILE" ]]; then
  step "Drafting the release page"
  gh release create "$TAG" --draft --title "$notes_title" --notes-file "$notes_body"
  note "Draft written. It goes live when the packages are attached."
fi

echo ""
echo -e "${GREEN}✓${NC} $TAG published. The packaging run is starting."

# Printed only when the remote is one this link would reach. A URL assembled
# out of a path that is not a GitHub remote is worse than no URL.
origin_url="$(git config --get "remote.$REMOTE.url" || true)"
if [[ "$origin_url" == *github.com* ]]; then
  slug="$(echo "$origin_url" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
  echo ""
  echo "    https://github.com/$slug/actions"
fi
echo ""

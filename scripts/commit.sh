#!/bin/bash
# Format, re-stage and commit.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! git rev-parse --git-dir &>/dev/null; then
    echo "Not a git repository."
    exit 1
fi

bash tidy.sh

git add -A

if git diff --cached --quiet; then
    echo "Nothing to commit."
    exit 0
fi

if [[ $# -gt 0 ]]; then
    git commit -m "$*"
else
    git commit
fi

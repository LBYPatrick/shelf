#!/bin/bash
# Retry transient mirror/index failures without accepting unverified packages.
set -euo pipefail

for attempt in 1 2 3; do
  if sudo apt-get -o APT::Update::Error-Mode=any update &&
    sudo apt-get install --yes --no-install-recommends rpm libarchive-tools; then
    exit 0
  fi
  if [[ "$attempt" -eq 3 ]]; then
    echo "Linux packaging dependencies failed after three attempts." >&2
    exit 1
  fi
  # Discard stale indexes before asking the mirror for a consistent set again.
  sudo rm -rf /var/lib/apt/lists/*
  sleep 10
done

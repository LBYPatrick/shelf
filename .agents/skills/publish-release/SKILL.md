---
name: publish-release
description: Prepare and publish a Shelf release, including changelog, release notes, version bump, tags, and package verification. Use when asked to cut, ship, or publish a release, or prepare its release notes.
---

# Publishing a Shelf release

Run commands from the repository root. Read `AGENTS.md`, `scripts/publish.sh`,
and `.github/workflows/release.yaml` before releasing.

`make publish` synchronizes `VERSION`, `package.json`, and the README badge,
runs the full gate, commits the version files, pushes `main`, creates and pushes
an annotated tag, and drafts the release page. The packaging workflow attaches
macOS, Linux, and Windows packages before making the draft public.

A request to publish authorizes this release workflow. If asked only for notes
or a release plan, prepare those without publishing.

## Prepare

1. Fetch `origin` and tags. Inspect the current branch, working tree, latest
   release tag, commits since that tag, and `CHANGELOG.md`'s Unreleased section.
   Include the intended uncommitted fixes in the review; do not silently omit
   them or include unrelated changes.
2. Use the user's requested version. Otherwise choose a semantic version from
   the changes and state why. Never reuse or move an existing release tag.
3. Finish and validate the intended changes, then commit them in focused
   Conventional Commits. Run `make format` before committing.
4. Publishing requires `main`. When starting on `dev`, fetch and inspect its
   relationship to `origin/main`, integrate the release's changes into `main`,
   and prefer fast-forward merges when possible. Preserve work and resolve
   conflicts explicitly; do not force-push, reset away changes, or stash them
   out of the release accidentally.
5. Write reader-facing changelog entries for the reviewed changes. Move them
   under `## [X.Y.Z] - YYYY-MM-DD` using today's date and retain an empty
   `## [Unreleased]` above it. Commit the changelog separately:

   ```bash
   git add CHANGELOG.md
   git commit -m "docs(changelog): release X.Y.Z"
   ```

## Write release notes

Write a temporary JSON file outside the repository:

```json
{
  "title": "Shelf X.Y.Z",
  "body": "Markdown release notes."
}
```

Lead with the visible behavior that changed. Use the changelog's `### Added`,
`### Changed`, and `### Fixed` groups only when nonempty. Omit commit hashes,
internal file names, and a closing summary. Do not claim live-provider
verification when only simulated tests were available.

## Publish and verify

```bash
make publish V=X.Y.Z NOTES=/absolute/path/to/notes.json YES=1
```

The script refuses uncommitted files except `VERSION`, `package.json`, and
`README.md`. It also refuses a branch behind `origin/main` or an existing tag.
If the gate fails before pushing, fix the cause and rerun. If a push or GitHub
operation fails, inspect the remote branch, tag, release, and Actions state
before retrying; never recreate a released tag to repair a failed packaging job.

Watch the tag's release workflow to completion. Verify that the published
release contains all three platforms and their updater metadata. If packaging
fails, inspect the failed job and fix or rerun it as appropriate; report any
external blocker rather than calling a draft with no packages a finished release.

After a release from `dev`, fast-forward it to the release commit and push `dev`
so it includes the version bump and stays aligned with `main`. Return to the
branch the user was working on. Report the version, release URL, validation,
and any remaining packaging or publication failure.

## Recover a failed package build

For an existing unpublished tag, commit validated packaging fixes on `main`
and push `HEAD:refs/heads/release/vX.Y.Z`. The release workflow compares the
recovery commit with the immutable tag, permits only the files listed in
`scripts/check-release.mjs`, and rejects changes to application code or runtime
manifest dependencies. Review the lockfile to confirm only packaging tooling
changed. A public release requires a new version instead.

Watch all three package jobs and publication to completion. The workflow uses
the committed changelog when it needs to create a draft, so recovery does not
require local GitHub API write access when the authorized Git push succeeds.
Keep `dev` aligned with `main` and return to the original branch afterward.

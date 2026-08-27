---
name: publish-release
description: Cut and publish a Shelf release — decide the version, move the changelog's Unreleased section under it, write the release page's title and body, and run `make publish`. Use when the user says "publish a release", "cut a release", "ship 1.2.0", or asks for release notes to go out.
---

# Publishing a release

`make publish` does the mechanical half: it brings `package.json` to whatever
`VERSION` says, runs the gate, commits, pushes `main`, tags, and drafts the
release page. The packaging workflow attaches the macOS, Linux and Windows
files and takes the draft live about forty minutes later.

What it cannot do is decide which number this is or say what changed. That is
this skill.

## Steps

### 1. Read what happened

```bash
git describe --tags --abbrev=0        # the last release, if there is one
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
sed -n '/## \[Unreleased\]/,/^## \[/p' CHANGELOG.md
```

The changelog is the better source — it is written for readers and the commits
are not. The log is how you check the changelog is not missing anything.

### 2. Decide the version

Semantic versioning, read off the changes rather than off a habit:

- **major** — something people relied on is gone or behaves differently.
- **minor** — new capability, everything that worked still works.
- **patch** — fixes only.

If the user named a version, use it. Otherwise say which you picked and why in
one sentence, and continue — do not stop to ask.

### 3. Move the changelog under that number

Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` with today's real date,
and put a fresh empty `## [Unreleased]` above it. Commit that on its own:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): release X.Y.Z"
```

It has to be committed before the next step. `make publish` refuses to run with
anything uncommitted other than the two version files, because a release commit
carries the version and nothing else.

### 4. Write the notes

A JSON file, somewhere temporary — it is an argument, not a file the repository
keeps:

```json
{
  "title": "Shelf 1.2.0",
  "body": "Markdown for the release page."
}
```

The body is what somebody reads to decide whether to download this. Lead with
what they can now do that they could not before. Group under `### Added`,
`### Changed`, `### Fixed` — the changelog's own headings — and drop any group
that is empty. Name the visible thing, not the file it happened in: "the tab
strip remembers what was open" rather than "fixed session serialisation in
`useTabs.ts`".

No commit hashes, no "bumped dependency" lines, and no closing summary.

### 5. Publish

```bash
echo "X.Y.Z" > VERSION
make publish V=X.Y.Z NOTES=/path/to/notes.json YES=1
```

`YES=1` skips the confirmation, which is right for an agent and wrong for a
person. The gate runs inside it and takes about forty seconds; if it fails,
nothing has been pushed — fix it, commit, and run the same command again.

Report back with the tag and the Actions URL the script prints.

## What will stop you

- **Not on `main`.** Publishing runs from `main`.
- **Behind `origin/main`.** Pull first; rebasing under a release is not the
  script's business.
- **The tag already exists.** A released version is not cut again. Bump.
- **A stray uncommitted file.** Commit it or stash it — see step 3.

# Shelf motion plans

Read the [whole-app audit](000-whole-app-motion-audit.md) first. Source reviewed at `b8294a4`; application code was not modified by the audit. All five plans have been implemented. These are the five highest-priority implementation slices, chosen autonomously because the user is AFK.

| Plan | Severity | Status |
| --- | --- | --- |
| [001 Preserve every tree collapse action](001-preserve-every-tree-collapse-action.md) | HIGH | Implemented |
| [002 Keep streaming chats pinned](002-keep-streaming-chats-pinned.md) | HIGH | Implemented |
| [003 Make keyboard motion immediate](003-make-keyboard-motion-immediate.md) | HIGH | Implemented |
| [004 Honor reduced motion in JavaScript](004-honor-reduced-motion-in-javascript.md) | MEDIUM | Implemented |
| [005 Finish connection sheet exits reliably](005-finish-connection-sheet-exits-reliably.md) | MEDIUM | Implemented |

Recommended order: **001 → 002 → 003 → 004 → 005**. The first two repair function before decoration. Plans001 and002 are independent. Plan004 can reuse the input-origin policy from003; avoid concurrent edits to that shared policy. Plan005 changes Sheet's event contract, so run gate-full and coordinate any shared-component work from003 before landing it. Keep each plan reviewable as a separate change.

Remaining findings F08–F17 are explicitly recorded in the audit; these five plans do not exhaust that backlog. Resolve remaining accessibility, moving-target and interruption findings before accepting the whole-app motion quality bar. Apply the five vetted decorative opportunities only after functional and accessibility issues are addressed.

The preceding tab overflow/context actions/duplicate fix is already committed and pushed as `b8294a4`; the audit and these plans are separate deliverables. No source edits, builds, formatter runs, dependency installs or commits were performed by the audit skills.

## Corner consistency audit

[Whole-app corner audit](006-whole-app-corner-audit.md) covers all83 Vue components, shared CSS and SVG shapes, with prioritized Before/After/Why findings, a proposed semantic radius vocabulary, and documented square/asymmetric exceptions. Semantic radius tokens and the recommended role-based migration are implemented; structural square edges remain intentional. This audit is separate from the five motion implementation plans.

## Implementation review

The implementation addresses F01–F17: action loss, transcript pinning, keyboard and reduced-motion policy, editor motion, actual sheet exits, stationary tile tools, stable filter identity, trigger dismissal, disclosure reversal, toast re-grab geometry, loading material, chart transforms and pointer ownership. Settings and result export now use wide layouts with contained scrolling and token-based corners. Settings keeps a stable frame across categories, and JSON fills the available pane. Jobs has a persistent top-right activity control, live count tooltip and bounded success/failure feedback. Optional attachment and sign-in decoration were not added; precision data and editing surfaces remain immediate.

The audit files retain the original observations for traceability. Final verification covers the unit, renderer type, build, UI, e2e and Storybook gates, plus wide/narrow Settings and export visual review.

See the [implementation review](007-implementation-review.md) for Before/After/Why findings, retained exceptions and verification evidence.

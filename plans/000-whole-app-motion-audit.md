# Whole-app motion and interaction audit

Commit: `b8294a4` · 7 October 2026 · Source review, not a runtime performance measurement.

Applied **find-animation-opportunities**, **improve-animations**, and **review-animations**, using Emil design engineering and Apple design principles within Shelf's repository rules. The audit covered all **83 Vue components**, **82 story files**, conditional fragments, keyboard/pointer handlers, shared styles, state updates, overlay dismissal, gesture helpers, Monaco, Tabulator, D3 and native-window boundaries. Three parallel, read-only specialist passes covered connections/settings, sidebar/chat, and data views; the primary pass covered shared controls/chrome and checked the reported defects against source. Stories supplied state coverage; this does not mean every interaction was exercised live.

The preceding tab fix is implemented and pushed as `b8294a4`. This audit is **read-only on application source**. The five plans below are recommendations, not implemented changes.

## Reconnaissance and constraints

Vue transitions, CSS transitions/keyframes, D3 transitions, a custom pointer-capture `useDrag`, and Monaco's own scrolling handle motion. No new animation library is warranted. Tokens in `src/renderer/styles/base.css:225` are `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`, and `--ease-sheet: cubic-bezier(0.32,0.72,0,1)`. Durations are press 140ms, hover 180ms, pop 220ms, panel 260ms, sheet 300ms. Desktop hit targets remain at least 28px outside the density factor.

Keyboard editing, command selection, tab navigation, and data manipulation happen dozens to hundreds of times daily: state and focus should update immediately. Occasional pointer disclosures can use 140–220ms feedback. Large sheet transitions retain their established 300ms curve; a shared overlay must not defer the business operation until an animation ends. Long progress loops are legitimate status feedback, not oversized entrance transitions.

The global reduced-motion rule already suppresses CSS loops and excludes transform/layout from transition properties. It does **not** cancel JavaScript timers, D3 transitions, Monaco scrolling, animation delays, or static `:active` transforms. Findings below account for this existing protection.

Repository-specific exceptions remain deliberate: sheet content-height measurement, synchronized column widths, virtual-list geometry, folding query results, bounded checkbox/circuit SVG effects, and status indicators. Do not replace these indiscriminately with transforms. Preserve the transparent root, opaque overlays, token surfaces, and no in-page blur rule.

## Prioritized findings

| ID | Severity / category | Evidence and current behavior | Exact direction |
| --- | --- | --- | --- |
| F01 | HIGH · function / interruption | `components/sidebar/EntityTree.vue:196`: one shared collapse timer is cleared before a different collapse is committed. Collapse A then B within 140ms cancels A's requested store change. Keyboard uses the same path at :530. | Commit keyboard/reduced actions immediately. Pointer effects must never cancel a requested toggle; serialize/flush pending state before replacing its visual exit. Plan 001. |
| F02 | HIGH · continuity | `components/assistant/ChatTab.vue:245` observes item counts/running flags; `stores/assistant.ts:517` appends streamed text without changing those counts. With `overflow-anchor: none` at ChatTab :702, the pinned transcript can stop following its growing content. | Observe transcript geometry, coalesce once per frame, recheck active/pinned status after scheduling, and jump to the bottom without smooth scrolling. Plan 002. |
| F03 | HIGH · frequency / input modality | `views/Workspace.vue:72,1501` animates every new tab's regions for 300ms with delays up to 175ms, including the keyboard new-query command. `SegmentedControl.vue:73,151`, shared `.menulist` at `styles/controls.css:530`, and keyboard filter reveal `TableTab.vue:347,635` similarly share pointer animation paths. | Keyboard state/focus and region visibility are instant. Explicitly retain pointer-only motion; no cascades through editor/results. Plan 003. |
| F04 | MEDIUM · reduced motion | `views/Workspace.vue:1539` substitutes a fade but retains 45–175ms delays and backwards fill. The global duration clamp does not remove these delays. | Clear delays, and suppress keyboard entrances entirely. Included in Plan 003. |
| F05 | MEDIUM · accessibility / timing | `lib/hoverTip.ts:37,101` keyboard focus uses the first-hover 420ms delay; `HoverTip.vue` then animates its entrance. | Focus-visible labels appear immediately and without travel; retain pointer dwell/grace behavior. Included in Plan 003. |
| F06 | MEDIUM · reduced motion / consistency | `viz/ErdCanvas.vue:343,350` uses D3 400/180ms transitions; `viz/ExplainTree.vue:310,315` uses 180/300ms; `editor/SqlEditor.vue:380` enables smooth scrolling unconditionally. CSS cannot disable these JavaScript animations. | Live reduced-motion preference, interrupt then set transforms directly; pointer zoom 180ms/fit 260ms ease-out, keyboard 0ms. Disable Monaco smooth scrolling and smooth caret under reduction. Plan 004. |
| F07 | MEDIUM · exit lifecycle | `connection/ConnectionEditor.vue:48` waits a hardcoded 260ms for a sheet whose transform lasts 300ms. Saving at :102 emits immediately; parent handlers `views/ConnectionManager.vue:426` and `views/Workspace.vue:163` unmount the editor, cutting off exit. | Shared sheet reports completed leave; parents preserve the editor until that event. Save/connect work starts immediately. Plan 005. |
| F08 | MEDIUM · hit targets / keyboard | `styles/controls.css:793` translates tile action targets 6px on hover/focus over 220ms. The tool a reader is trying to click is moving. | Stationary button boxes. Pointer reveal opacity 140ms ease-out; keyboard reveal 0ms. Keep targets 28px. |
| F09 | MEDIUM · reduced motion | Static press transforms remain in `ui/PressButton.vue:80`, `assistant/ChatTab.vue:849,890,1030,1066,1117`, `assistant/CliSignInSheet.vue:238`, `sidebar/JobList.vue:652`, `chrome/TabStrip.vue`, and `styles/controls.css:693,815`. A transition-property override does not neutralize scale itself; tile-tool reduced selectors lose to `:active` specificity. | Matching reduced-motion `:active` selectors set transform:none; short color/opacity feedback can remain. Do not remove normal pointer feedback. |
| F10 | MEDIUM · identity / list motion | `sidebar/FilterChips.vue:104` includes array index in its TransitionGroup key. Removing an earlier criterion changes surviving keys, producing remount/enter/leave instead of stable movement. | Stable semantic identity where uniqueness is guaranteed; otherwise persist a criterion ID. Pointer removal: existing 180ms transform reflow; keyboard removal instant. |
| F11 | MEDIUM · overlay function | `assistant/InlinePicker.vue:97` omits the existing trigger ref when rendering ContextMenu. Capture-phase outside dismissal can close it before its trigger click reopens it. | Supply `:trigger="trigger"`, preserving toggle semantics, top-overlay Escape, and focus behavior. Motion-adjacent UX bug, not a reason to add animation. |
| F12 | MEDIUM · interruption | `ui/DisclosureGroup.vue:22` starts enter at 0 and leave at full scrollHeight, without cancellation hooks. Reversing mid-transition can restart at an endpoint. | Resume from the rendered height; deliberate measured layout stays. Pointer 220ms ease-out; keyboard/reduced 0ms geometry. Verify reversal live before claiming measured jumps. |
| F13 | MEDIUM · gesture continuity | `chrome/ToastItem.vue:73` reads the reactive offset; release sets it to zero while CSS visibly returns over 220ms. A second grab during return can start from logical zero rather than the painted position. | Capture rendered translation before re-grab; cancel return and resume there. Preserve existing momentum dismissal and immediate removal. This is a source-based risk requiring a live re-grab check. |
| F14 | MEDIUM · compositing / material | `grid/DataGrid.vue:724` blurs the loading veil, contradicting the no in-page blur rule and adding a filter pass over dense content. | Remove both backdrop-filter declarations. Keep the token dimming fill and 140ms opacity entrance; no row animation. |
| F15 | MEDIUM · rendering cost | `viz/RankedBars.vue:127` animates width/inset; `viz/ShareDonut.vue:261` animates legend width. Isolated absolute elements limit the cost, but geometry changes are avoidable. | Direct transforms on fill elements, stable labels/axes, 220ms ease-out pointer updates; reduction sets geometry immediately. Profile before claiming a frame-rate benefit. |
| F16 | MEDIUM · gesture ownership | `viz/StatementHistogram.vue:191` captures a pointer but stores no active pointer ID; a second pointer can overwrite the brush anchor and another pointer can move/end it. | One active pointer; ignore other IDs, handle cancellation/lost capture. Keep precision brushing immediate, with no inertia. |
| F17 | LOW · input modality | `views/Workspace.vue:1356` collapse-icon hover transforms are ungated; `connection/EnginePicker.vue` animates keyboard-selected marks; Monaco's find/replace chevron also rotates during keyboard editing. | Pointer-fine/hover gating for hover travel, keyboard marks and editor disclosures instant. EnginePicker is included in Plan 003. |

Paths beginning `components/`, `views/`, `stores/`, `lib/`, and `styles/` are relative to `src/renderer/`.

## Eight-category review

| Category | Result |
| --- | --- |
| Purpose and frequency | Biggest mismatch is keyboard work inheriting pointer entrances. Dense rows/editor text correctly remain static in most places. |
| Duration and easing | Shared token scale is coherent; Workspace's stacked delay and D3's 400ms/default curve are exceptions. Long progress loops are justified. |
| Properties and rendering | Most motion uses opacity/transform. F14/F15 deserve correction; sheet/column/fold layout has documented functional reasons. No measured jank claim. |
| Interruption and gestures | Shared useDrag has pointer ownership, capture-loss handling and velocity projection. EntityTree, disclosure reversal, toast re-grab, and histogram ownership need attention. |
| Enter/exit and physical origin | Menus and sheets generally have correct origins and decelerating curves. Connection editor ownership truncates otherwise coherent exits. |
| Accessibility and input | Global CSS coverage is strong; JavaScript preference handling, surviving active scales, tooltip focus delay and keyboard motion are the main gaps. |
| Composition and choreography | Workspace's regional cascade is costly for repeat work; static charts/grids and non-staggered libraries are good. Tile action travel reduces target stability. |
| Consistency and feedback | Shared controls/surfaces provide a solid language. Copy/import/verdict feedback has small missing opportunities; no broad decorative animation is warranted. |

## Vetted opportunities — find-animation-opportunities

Each row passes purpose, frequency, speed and function checks. These are future recommendations, not additions made during this audit. CSS values must go directly on the animated element; no inherited root animation variables.

| Location | Today | Purpose / frequency | Exact motion and safeguards |
| --- | --- | --- | --- |
| `connection/ConnectionForm.vue:781,835` SSH/proxy blocks | Conditional fields appear at once. | Clarify which configuration section was enabled; occasional setup. | Pointer toggle only: opacity 0→1 over 140ms `var(--ease-out)`, exit 100ms opacity. No per-field stagger or extra height tween; Sheet owns height. Keyboard 0ms; reduced opacity only, at most 150ms. Fields become focusable immediately. |
| `grid/ValueSheet.vue:47` Copy | Clipboard write has no visible success state. | Confirm completion without a toast; occasional inspection. | After successful copy, fixed-size icon crossfade opacity 140ms ease-out; reserve label width for Copy/Copied, reset after 2s. Keyboard text/state instant, no animated focus; reduced ≤150ms opacity. Announce via status, never show success on failure. |
| `tabs/ImportSheet.vue:211` Running | Button becomes disabled and says Importing. | Make an asynchronous wait visibly active; occasional long operation. | Existing ProgressBar appears opacity 140ms ease-out. Its existing 1.1s transform loop carries activity, not invented percent progress. Reduction shows a static indicator and Importing text. Import starts immediately; no table/preview fade. |
| `assistant/ChatTab.vue` attachment chips | Pointer-dropped attachment appears without a local acknowledgment. | Confirm the accepted item; occasional drop. | Only a pointer drop gets opacity 0→1 for 140ms ease-out, no stagger, no scale/travel. Paste/keyboard adds and errors are instant. Reduced ≤150ms opacity; chip removal and file ownership remain immediate. |
| `assistant/CliSignInSheet.vue:144` check verdict | Returned verdict appears without an arrival cue. | Make the completed check easy to notice beside its button; occasional account setup. | Reserved result row, opacity 0→1 for 150ms ease-out after completion; no command-text animation or second layout tween. Keyboard verdict instant; reduced opacity only. Preserve live status announcement. |

## Rejected candidates

- **Grid/result row entrances, SQL-token fades and chart grow-from-zero:** frequent data inspection needs immediate, trustworthy geometry. Never stagger Tabulator rows or animate editor input.
- **Welcome, history, chat and connection-library item cascades:** large saved libraries and search/filter churn turn stagger into a queue. Preserve static filtering and recycling.
- **Streaming token reveals or smooth transcript follow:** the model already supplies the temporal cue; restarting scroll animation falls behind. Fix pinned follow instead.
- **Palette results, shortcut recording and inline rename animation:** keyboard workflows demand zero latency and stable focus. Cursor feedback is sufficient.
- **Physics/inertia on resize handles, histogram brushes or database selection:** precise manipulation should follow the pointer exactly. Keep momentum only for intentional toast dismissal. No blur opportunity is proposed; OS material already supplies the glass.

## Review-animations verdict

**BLOCK at the whole-app motion quality bar.** This is a review verdict, not a request for approval or a claim that every component is broken. F01 loses an action, F02 breaks continuity, F03 delays repeated keyboard work, and F06 leaves JavaScript motion enabled under reduction. These precede decorative opportunities.

| Before | Recommended after | Why |
| --- | --- | --- |
| One delayed tree toggle can replace another. | Every requested toggle commits; visuals cannot own the store operation. | Function comes before motion. |
| Streaming text can grow without triggering follow. | Active pinned transcript follows measured growth instantly. | The reader retains context without chasing the answer. |
| Keyboard new tabs cascade for up to 475ms. | Keyboard regions and focus are immediate; bounded pointer entrance only. | Repeated work should feel direct. |
| CSS reduction leaves D3/Monaco JavaScript motion running. | Live preference reaches each imperative animation path. | Accessibility must cover the actual animation engine. |
| Connection saving unmounts the sheet during exit. | Business operation runs now; teardown follows shared after-leave. | One predictable exit across save/cancel/Escape. |
| Tile action hit boxes slide on focus/hover. | Stationary targets with brief pointer opacity feedback. | Motion should not make a click harder. |

Passing foundations: shared timing/easing tokens; opaque sheets/menus; no scaling of dense editor/grid regions; static high-volume data; bounded loading indicators; top-overlay Escape; direct precise drags; momentum-aware toast throws; tooltip grace between pointer targets; sheet natural-height behavior; fixed tab hit targets from the preceding fix.

## Component and fragment coverage

The ledger records source/state coverage, not a claim that all combinations were rendered or performance-profiled. “Shared” means the component inherits the relevant controls/Sheet/material behavior and is included in those findings.

| Component | Reviewed fragments / interactions | Finding or disposition |
| --- | --- | --- |
| `App.vue` | Startup, connected/disconnected view ownership, theme/host bootstrap | Static view boundary |
| `components/assistant/ChatItem.vue` | Every assistant item union/step state, intent/manual folds, rows/SQL/error/inner-fold | Preserve intentional result fold geometry; shared modality |
| `components/assistant/ChatTab.vue` | Setup/opening/suggestions/stream/error/send-stop/draft/scope/provider/sign-in/drop-paste-remove | F02/F09; attachment opportunity |
| `components/assistant/CliSignInSheet.vue` | Command/copy/copied/check/verdict/all account states | F09; verdict opportunity |
| `components/assistant/InlinePicker.vue` | Provider/generic/missing/label/icon slot/open/choose/caret | F11 |
| `components/assistant/MarkdownText.vue` | Safe prose/links/lists/tables/code/stream caret | Static document; reduced caret handled |
| `components/assistant/ProviderMark.vue` | Brand/fallback/contrast/size | Static |
| `components/assistant/ProviderSheet.vue` | List/detected/unavailable/editor/API/model/validation/test/delete/save | Shared sheet/controls |
| `components/assistant/ResultTable.vue` | Tagged values/empty/50-row cap/truncation/duration/sticky scroll | Static data |
| `components/assistant/SqlBlock.vue` | Named/unnamed/read-write/format fallback/copy/open query | Static readable statement; shared press |
| `components/assistant/SqlCode.vue` | Token/theme/whitespace/wide SQL, indirect story coverage | Static code |
| `components/chrome/CommandPalette.vue` | Commands/tabs/entities, empty/path hints, paging/wrap/selection/commit | Keep keyboard search/selection instant |
| `components/chrome/HoverTip.vue` | First/subsequent hover, grace, focus, placement, dismissal | F05 |
| `components/chrome/StatusBar.vue` | Connected/busy/error/completion, activity wash/live status | Purposeful status feedback; avoid new entrance effects |
| `components/chrome/TabStrip.vue` | Empty/crowded/every kind, long scope/title, close/menu/ranges/duplicate/reorder/rename, marker | Overflow/action fixes shipped; F03/F09 |
| `components/chrome/ToastItem.vue` | All tones/long/actions/live status/countdown pause/swipe/re-grab | F13 |
| `components/chrome/ToastStack.vue` | Empty/one/several/many, enter/leave/move | Bounded list motion; inherits F13 |
| `components/connection/ConnectionEditor.vue` | New/edit/test/saving/error/discard/cancel/Escape/save/connect | F07 |
| `components/connection/ConnectionForm.vue` | Engine-specific fields/files/secrets, security/SSH/proxy/SSL, validation, test/save input | Opportunity routing blocks; shared controls |
| `components/connection/EngineMark.vue` | Every supported engine/size | Static |
| `components/connection/EnginePicker.vue` | Selection/grid, keyboard arrows, selected icon/mark | F17/F03 |
| `components/connection/LineupRow.vue` | Selected/idle/error/busy/name/detail/menu/focus | Shared controls; stable targets |
| `components/editor/SqlEditor.vue` | Models/cursor/completion/commands/read-only/theme/font/wrap/find/widgets | F06/F17 |
| `components/grid/DataGrid.vue` | Tabulator rows/loading/sort/scroll/resize/selection/copy/edit/locked values/hidden geometry | F14; deliberate relayout guards |
| `components/grid/ExportSheet.vue` | Destination/format/scope/errors/copy/file/busy/elapsed/close | Purposeful busy ring; shared Sheet |
| `components/grid/FilterBar.vue` | Builder/raw/criteria/operators/conditionals/clear/apply/Enter/focus | Static precise filtering |
| `components/grid/RowIndexToggle.vue` | Selected/unselected, segment switching | Shared F03 |
| `components/grid/ValueSheet.vue` | Types/size/JSON/null/empty/raw/pretty/copy/done | Copy opportunity |
| `components/settings/PaletteStrip.vue` | Palette previews/current selection/pointer/key | Static preview; no color morph |
| `components/settings/SettingsSheet.vue` | Every section/appearance/import-export/help/manage-sheet routing | Shared sheet/controls; options reachable |
| `components/settings/ShortcutSheet.vue` | Default/override/recording/conflict/reset, capture/commit/cancel | Keep recording instant |
| `components/settings/StorageSheet.vue` | Counts/errors/clear confirmation/reload | Shared sheet; static facts |
| `components/settings/UpdateSheet.vue` | Checking/current/available/download/error/restart/release notes/phase transition | Rare phase fade acceptable; no prose animation |
| `components/sidebar/ChatList.vue` | Search/empty/refresh/open/rename/discard/timestamps | Shared tile F08/F09 |
| `components/sidebar/ConnectionSwitcher.vue` | Active/none/connecting/failure/name/version/read-only/menu/diagnose/manage/disconnect | Purposeful live pulse; shared controls |
| `components/sidebar/DiagnoseSheet.vue` | Warm-up/sample chart/verdict/error/re-run/facts | Static data, shared Sheet |
| `components/sidebar/EntityTree.vue` | Virtual groups/entities/columns/documents, open/collapse, keyboard, menus/exports/reveal | F01 |
| `components/sidebar/FilterChips.vue` | Add/remove/enable/disable/kind/value/back/popup/list movement | F10 |
| `components/sidebar/HistoryList.vue` | Scope/refresh/search/empty/row counts/open/tips | Shared tile F08/F09 |
| `components/sidebar/JobList.vue` | States/rename/filter/discard/context/export/elapsed timers | F08/F09; timers meaningful |
| `components/sidebar/SavedQueryList.vue` | Search/empty/open/rename/duplicate/delete/keyboard | Shared tile F08/F09 |
| `components/tabs/AnalyzePanel.vue` | Controls/metrics/rank selection/details/server gauges/histogram range | Child findings; no data entrance cascade |
| `components/tabs/ContainerPropertiesSheet.vue` | Overview/queries/server/loading/error/facts/largest/deferred analysis | Shared sheet; bounded loading fade |
| `components/tabs/EntityStructure.vue` | Capabilities/columns/indexes/relations/triggers/partitions/load errors/resize/schema proposals | Direct column resize; static records |
| `components/tabs/ErdTab.vue` | Scope/loading/error/empty/canvas/double-click/status | Child F06 |
| `components/tabs/ImportSheet.vue` | File/preview/mapping/unmatched/replace/busy/error/close | Import progress opportunity |
| `components/tabs/JobTab.vue` | States/paging/skeleton/grid/error/index/export | Static rows; child findings |
| `components/tabs/QueryTab.vue` | Run modes/cancel/time/limit/format/explain/save/dispatch/transactions/results/errors/splits/status | Purposeful busy loop; no SQL/result entrance |
| `components/tabs/QuickDocsSheet.vue` | Lazy loading/facts/comments/columns/tags/copy/done | Shared Sheet; copied feedback exemplar |
| `components/tabs/SchemaChangeSheet.vue` | SQL/proposal/destructive typed confirmation/run/cancel/copy/error | Immediate validation; shared Sheet |
| `components/tabs/TablePropertiesSheet.vue` | Facts/structure/internal scroll/capabilities/done | Shared Sheet |
| `components/tabs/TableTab.vue` | Filter/edit/pending/discard/preview/apply/import/error/refresh/paging/grid | F03 |
| `components/ui/AppIcon.vue` | Every icon/size/filled state | Static |
| `components/ui/AppMark.vue` | Size/brand variants | Static |
| `components/ui/CheckBox.vue` | Checked, unchecked, hint, disabled, pointer/keyboard | Shared input-modality; bounded SVG tick justified |
| `components/ui/CircuitRing.vue` | Tracing, thickness/rounding/bordered variants, reduction | Purposeful bounded status loop |
| `components/ui/ContextMenu.vue` | Pointer/keyboard open, disabled/separators/icons, edge placement, trigger dismissal, Escape | F03/F11 |
| `components/ui/DisclosureGroup.vue` | Open/closed/hint, measured enter/leave, rapid reversal, keyboard | F03/F12 |
| `components/ui/FormField.vue` | Label/help/error/slot ID | Immediate validation is appropriate |
| `components/ui/GridSkeleton.vue` | Narrow/wide/default loading, reduced motion | Purposeful transform loading loop |
| `components/ui/JsonEditor.vue` | Empty/editable/read-only, validation/edit events | Static precise editing |
| `components/ui/NameSheet.vue` | Generation, busy/error, renamed/unsaved naming, submit/cancel | Shared Sheet; keyboard state instant |
| `components/ui/PressButton.vue` | Ghost/primary/glass/danger/disabled/active/small/icon, press/focus | F09 |
| `components/ui/ProgressBar.vue` | Primary/error, indeterminate/reduction | Purposeful transform loop |
| `components/ui/RangeSlider.vue` | Floor/middle/ceiling, drag/key input | Direct manipulation; no new physics |
| `components/ui/ResizeHandle.vue` | Horizontal/vertical, hover/focus/capture/keyboard bounds | Shared modality; retain direct drag |
| `components/ui/SegmentedControl.vue` | Two/three options, measured indicator, resize, arrow navigation | F03 |
| `components/ui/SelectMenu.vue` | Closed/open/long labels/clipping, pointer and key selection | F03/F09; shared anchored list |
| `components/ui/Sheet.vue` | Short/tall/footer/icon/wide/broad, height measurement, stacked dismissal, focus return | F07; preserve deliberate geometry |
| `components/ui/StatusChip.vue` | Done/running/pending/failed/reduction | Purposeful bounded status feedback |
| `components/ui/SuggestInput.vue` | Own value/options/plain, typing/filtering, arrows/selection | F03 |
| `components/ui/TextInput.vue` | Empty/filled/invalid/disabled/mono/password reveal | Static form state; shared press |
| `components/ui/ToggleSwitch.vue` | Off/on/disabled, Space and pointer toggle | F03 |
| `components/viz/ErdCanvas.vue` | Force layout/persist/rebuild/pan/zoom/drag/pin/hover/double-click/columns/resize/fit | F06; visible force layout under reduction needs live check |
| `components/viz/ExplainTree.vue` | Plan hierarchy/cost/rows/details/tooltips/entry/pan/zoom/fit/export | F06; capped explanatory entry acceptable |
| `components/viz/LatencyTrace.vue` | Samples/median/worst/no data/trace | Static measured data |
| `components/viz/PlanSheet.vue` | Empty/plan/export/child interactions | Shared Sheet/child F06 |
| `components/viz/RankedBars.vue` | Empty/fill/inner partition/selection/hover/labels | F15 |
| `components/viz/ShareDonut.vue` | Empty/single/all/hover/dimming/legend/total/slices | F15; pointer-only slice emphasis handled |
| `components/viz/StatementHistogram.vue` | Empty/sparse/full/range/clear/log axes/buckets/brush/cancel | F16 |
| `components/viz/ZoomControl.vue` | Minus/plus/fit/percentage/press/reduction | Child F06; direct state feedback |
| `views/ConnectionManager.vue` | Welcome/large library/search/history/empty/pinned/actions/import/export/create/edit/sample/connect/settings | No library cascades; F07 |
| `views/Workspace.vue` | All rail panels/sidebar resize/collapse/topbar/new/reopened tabs/settings/library/editor/empty views | F03/F04/F07/F17 |

## Verification boundary and next work

For the **implemented tab change**, formatting, lint, node/renderer type checks, build, 748 unit tests, 121 UI checks and 77 end-to-end checks passed. UI/e2e passed with four workers after unrelated high-concurrency startup/Monaco fixture flakes in the default gate. No visual snapshots were regenerated. These results do not validate the unimplemented recommendations above.

The audit ran no builds, formatters, dependency installs, or source mutations. Performance concerns F13/F15 and disclosure reversal require targeted live reproduction. No claim of a full browser gesture sweep or measured compositing cost is made. Execute plans 001–005 first; then resolve remaining F08–F17 before accepting the app against this motion bar. Decorative opportunities come last. The plan README records order and boundaries.

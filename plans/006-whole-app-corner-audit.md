# Whole-app corner and radius audit

Reviewed at `b8294a4` · 7 October 2026 · Application source unchanged.

This is a source-based audit of **all 83 Vue components**, shared styles, SVG shapes, nested clipping, interactive states, and existing corner invariants. It applies Emil's attention to component consistency and Apple's principles of familiarity, hierarchy and craft within Shelf's documented design rules. It does not claim that every corner was visually rendered in every theme/state.

**Finding:** the app has a partial radius system, but similar objects still choose different shapes. The issue is not simply sharp versus rounded: controls mix 4px and 8px, menus mix 8px and 12px, and content cards mix 8px, 9.6px and 12px. Some square edges are deliberate and should remain square. At the default 16px root font, current tokens are field4px, box8px, selector16px and control8px. Light/dark fallback themes agree. Radius does not currently scale with density, while insets do.

The scan found **212 CSS corner/clipping declarations**, including **94 literal declarations** using **21 distinct literal expressions**. Literal pill/circle values and deliberate zero joins are included in these counts; counts are evidence of distribution, not a defect metric. Additional SVG shapes are recorded separately below. Story-only demo wrappers are not treated as production defects.

## Prioritized review

“After” describes a recommendation, not a change already made. Values below are rem-based and refer to the default root font.

| ID / priority | Before | Recommended after | Why |
| --- | --- | --- | --- |
| R01 HIGH | `styles/controls.css:202` TextInput wells use `--radius-field` =4px; `ui/SelectMenu.vue:172` and PressButton :50 use `--control-radius` =8px. NameSheet's generation button :168 uses4px beside8px select/button patterns elsewhere. | One 8px control/field radius for peer form controls and toolbar controls. Keep a separate4px micro radius for keycaps, inline code and tiny glyph frames. | Equal-height controls in one row should look like the same family. This is a visible inconsistency, not a need to round everything. |
| R02 HIGH | `.menulist` at `styles/controls.css:526` and Monaco widgets at `styles/monaco.css:204` use8px; ContextMenu :210 and FilterChips picker :319 use12px. | One12px popover token for menus, suggestions, editor hovers and context menus, with inset row corners derived from the actual padding. Tooltip remains8px as a smaller label object. | The same selection workflow currently changes shape according to which component opened it. |
| R03 MEDIUM | ResultTable :99 and SqlBlock :116 use12px; MarkdownText's table scroller :224 uses9.6px; ImportSheet preview :260 and properties-card wrappers use8px. | One12px standalone card/table-preview radius. Internal cells and separator joins remain0. Small recessed wells may retain8px as an explicit distinct role. | Comparable contained data objects should share an outline. Avoid changing dense data geometry. |
| R04 MEDIUM | ConnectionManager group rows :926 and history entries :1002 use4px, while sidebar job/chat/query tiles in `styles/controls.css:622` use8px; provider rows at ProviderSheet :436 use10px. | Use8px for standalone selectable/list cards across libraries and providers. Parent-owned grouped list rows stay square internally with clipping at the group's outer corners. | Library items should not look like text fields; row groups should not become piles of rounded cells. |
| R05 MEDIUM | Sheet :620 uses20px, CommandPalette :683 uses16px, composer :938 uses17.6px, chat question :739 uses16/16/5.6/16px; all are locally authored. | Semantic tokens: sheet20px, palette16px, composer16px, message16px with an explicitly named4px directional corner. Preserve role differences rather than collapsing them to one radius. | Large surfaces need a clear hierarchy, and conversation direction is meaningful; arbitrary17.6/5.6px values are unnecessary. |
| R06 MEDIUM | Engine badges: LineupRow :174 uses4px, EnginePicker :162 uses6.4px, ConnectionSwitcher :336 uses7px. Rail items/marker in Workspace :992,:1008 use9.6px. | Give comparable engine badges an explicit shared role (suggest8px for24–28px framed marks); glyph-only logos remain unchanged. Rail item/marker must share one named radius (8px recommended). | Brand artwork may differ, but the surrounding frames and selected markers should agree. |
| R07 MEDIUM | Connection feedback :212 is4px; ImportSheet error :325 is8px; ChatItem failure :436 and SchemaChange summary :107 are12px. TableTab error :657 is square and spans the tab width, whereas QueryTab error :1408 is4px. | Rounded inset notices use the12px card token. Full-width attached status bands intentionally use0 with no inset gap; document that distinction. Check TableTab/QueryTab ownership before styling both as cards. | Match corners to containment, not error severity or implementation age. The square table error is a candidate to verify visually, not automatically a bug. |
| R08 MEDIUM | Global `:focus-visible` in `styles/base.css:159` sets border-radius4px on the focused element itself. Components with more-specific radius rules keep theirs, while otherwise square/unclassified elements can change shape on focus. | Global focus rule supplies outline only; radius belongs to each visible surface/control. Retain Monaco's explicit0 reset at `styles/monaco.css:32` and all focused-control rings. | Focus should reveal the current shape, not mutate it. This is a cascade risk; verify affected controls before deleting the fallback. |
| R09 LOW | Segment indicator subtracts padding correctly (`SegmentedControl.vue:140`), and ZoomControl :74 adds padding correctly. Menulist row radius subtracts a fixed0.25rem at `controls.css:551`, though padding uses density-dependent `--gap-tight`. | Derive nested radii from actual inset: `max(0px, calc(var(--radius-popover) - var(--gap-tight)))`. Keep correct existing segment/zoom relationships. | Inner and outer arcs should remain concentric at compact/default/comfortable density. The current mismatch is small, not a proven clipping failure. |
| R10 LOW | Tiny shapes use local4px/4.8px/2px/1px; pills use999px; scrollbars use6px. SVG node frames use ExplainTree rx8 and ERD rx10. | Name micro4px, swatch2px, pill9999px and scrollbar6px roles. Share one graph-node12px role for peer diagram cards, or explicitly document a diagram-specific8px choice. Keep quantitative plot rectangles square. | Tokens prevent future drift; a tiny swatch is not supposed to have the same radius as a sheet. SVG values must use the same role and scale intentionally. |

## Proposed shape vocabulary

This is a recommendation for implementation, not a blanket token edit. Existing `--radius-box` is also used by structural clipping and must not be globally changed without migrating call sites by role.

| Role | Proposed value | Applies to |
| --- | --- | --- |
| Flush/structural | 0 | Continuous workspace columns, data cells, attached bars, internal split-control joins |
| Micro | .25rem (4px) | Keycaps, inline code, tiny square affordances; a16px checkbox may keep a separately documented .3125rem shape |
| Control/field | .5rem (8px) | Buttons, text/select/suggest fields, tab silhouettes, standalone list selections |
| Recessed well | .5rem (8px) | Small contained readouts, not every table/card |
| Card | .75rem (12px) | Contained tables, statement cards, notices, properties-card surfaces |
| Popover | .75rem (12px) | Menus, suggestion lists, Monaco floating widgets |
| Palette | 1rem (16px) | Command palette, a larger floating command surface |
| Composer/message | 1rem (16px) | Chat input and question; directional message corner .25rem is deliberate |
| Sheet | 1.25rem (20px) | Shared modal Sheet |
| Pill/circle | 9999px | Status badges, switches, chips, circular icon actions |
| Scrollbar / swatch | .375rem / .125rem | Specialized small visual shapes |

Keep corner radii independent of density for semantic consistency, but compute *nested* inner arcs using density-dependent padding. Rem units preserve larger OS text sizing. Do not add a corner-preference setting or animate radius when themes, density or focus change.

## Square and asymmetric edges to preserve

- **Workspace continuous column:** `views/Workspace.vue:1468` and its surrounding comments explicitly make the working pane square while the sidebar is open. The strip and pane are one material. A rounded seam here would manufacture a boundary. Collapsed state :1431 uses a top-leading clipped corner plus the matching tinted notch. Preserve `clip-path`, not rounded overflow, because Monaco's composited layer previously escaped overflow clipping.
- **Split buttons:** `styles/controls.css:439–449` and QueryTab's connected run/chevron pairs flatten internal joins and round only the outside. This is correct grouping, not inconsistent square corners.
- **Grid and structure cells:** Tabulator, EntityStructure, assistant table cells, histogram buckets and selection ranges represent contiguous data. Keep internal geometry square. Round only a freestanding outer card if it actually owns one.
- **Settings/shortcut JSON document mode:** SettingsSheet :1243 and ShortcutSheet :510 treat the editor as the sheet page, with its attached footer/status bar. A nested rounded editor card would contradict that ownership. Both are intentionally square and already agree.
- **Sidebar switcher flush leading edge:** ConnectionSwitcher :307 rounds only the trailing corners because it spans the rail/sidebar material. Preserve asymmetry; tokenize the trailing radius.
- **Chat directional question corner:** The question bubble's one tighter corner is semantic. Name and standardize it; do not force symmetry.
- **Pills, sliders, progress dots, swatches and brand assets:** circles/capsules and tiny visual shapes intentionally use different geometry. Shelf/AppMark and engine logos own their artwork; do not redraw logos to match CSS controls.

## Clipping and nested shapes

Correct patterns worth keeping: Sheet clips its opaque outer panel; settings/shortcut grouped cards clip rows once; ResultTable/SqlBlock clip contained content; SegmentedControl subtracts its inset; ZoomControl adds its padding; CircuitRing reads the traced parent's actual outer radius and border, then subtracts the inset for its stroke centerline.

Check the ERD header separately: `viz/ErdCanvas.vue:383–384` gives both the full node and its shorter header rx10, so the header rounds its bottom corners *inside* one continuous node. Prefer a header clipped by the node's outline with square lower joins. This is a source-based visual candidate requiring a rendered diagram comparison, not a measured rendering bug.

Do not add overflow clipping to every rounded container. It can cut focus rings, menus, graph shadows and tooltips. Anchored lists remain teleported. A radius token alone does not establish the right clipping owner.

## Recommended implementation order

1. Define semantic aliases in one shared style location, with the same values in light/dark. Retain the structural8px token until each call site is classified. Record the square/asymmetric exceptions above.
2. Resolve R01 and R02 first: form controls and floating menus create the most visible peer mismatches. Migrate by role, including editor-owned widgets.
3. Harmonize data cards, library/provider rows and notices (R03/R04/R07). Give grouped lists one outer clip, not rounded internal seams.
4. Replace large-surface/badge/micro literals with named roles (R05/R06/R10), preserving deliberate differences. Fix density-dependent nested math (R09).
5. Remove focus-owned shape mutation only after checking its fallback consumers (R08). Compare normal/focus/hover/pressed/disabled shapes.
6. Validate light/dark, compact/default/comfortable, larger root text, narrow/large libraries, menus near viewport edges, Monaco/query versus table tabs, clipped sheets, and graph SVG/export. Run `make format`, then `make`; use gate-full if props/story mocks change. Inspect visual diffs before accepting snapshots. Add targeted invariants for equal-height control peers and one popover family; do not write83 implementation-mirroring tests.

No source changes, builds, snapshot updates or test runs were made for this audit. Existing corner tests in `tests/ui/visual.spec.ts:124` and `tests/ui/invariants.spec.ts` protect structural pane corners and CircuitRing geometry, but are not proof that every peer component follows a radius vocabulary. Browser visual/cascade verification remains required when implementing the recommendations.

## Full component coverage ledger

Every Vue file was included. Entries list explicit CSS corner declarations; “no local declaration” does not mean square by mistake: the component may own no surface, inherit shared styles, render brand artwork, or use SVG. The role analysis above accounts for shared inheritance and continuous surfaces.

| Component | Local corner declarations / shape source |
| --- | --- |
| `App.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/assistant/ChatItem.vue` | border-radius `var(--radius-field)` (:248); border-radius `999px` (:320); border-radius `var(--radius-field)` (:403); border-radius `0.75rem` (:436) |
| `components/assistant/ChatTab.vue` | border-radius `1rem 1rem 0.35rem 1rem` (:739); border-radius `999px` (:761); border-radius `999px` (:839); border-radius `999px` (:877); border-radius `1.1rem` (:938); border-radius `var(--radius-selector)` (:1004); border-radius `var(--radius-selector)` (:1022); border-radius `var(--control-radius)` (:1058); border-radius `var(--radius-box)` (:1090); border-radius `999px` (:1109) |
| `components/assistant/CliSignInSheet.vue` | border-radius `var(--radius-field)` (:196); border-radius `var(--radius-selector)` (:225) |
| `components/assistant/InlinePicker.vue` | border-radius `var(--radius-field)` (:114) |
| `components/assistant/MarkdownText.vue` | border-radius `0.3rem` (:192); border-radius `0.6rem` (:224); border-radius `1px` (:266) |
| `components/assistant/ProviderMark.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/assistant/ProviderSheet.vue` | border-radius `0.625rem` (:436); border-radius `999px` (:481) |
| `components/assistant/ResultTable.vue` | border-radius `0.75rem` (:99) |
| `components/assistant/SqlBlock.vue` | border-radius `0.75rem` (:116) |
| `components/assistant/SqlCode.vue` | Static code renderer; parent owns its surface; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/chrome/CommandPalette.vue` | border-radius `1rem` (:683); border-radius `999px` (:730); border-radius `4px` (:736); border-radius `var(--radius-field)` (:784); border-radius `999px` (:802); border-radius `var(--radius-field)` (:840) |
| `components/chrome/HoverTip.vue` | border-radius `0.5rem` (:107) |
| `components/chrome/StatusBar.vue` | border-radius `999px` (:171) |
| `components/chrome/TabStrip.vue` | border-radius `var(--control-radius)` (:1020); border-radius `var(--control-radius)` (:1121); border-radius `0.25rem` (:1253); border-radius `999px` (:1273); border-radius `var(--control-radius)` (:1312) |
| `components/chrome/ToastItem.vue` | border-radius `var(--radius-box)` (:238); border-radius `var(--control-radius)` (:307); border-radius `var(--control-radius)` (:319) |
| `components/chrome/ToastStack.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/connection/ConnectionEditor.vue` | border-radius `var(--radius-field)` (:212) |
| `components/connection/ConnectionForm.vue` | border-radius `var(--radius-box)` (:892); border-radius `var(--radius-field)` (:1026) |
| `components/connection/EngineMark.vue` | Engine brand artwork owns its shape; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/connection/EnginePicker.vue` | border-radius `var(--radius-box)` (:124); border-radius `0.4rem` (:162) |
| `components/connection/LineupRow.vue` | border-radius `inherit` (:134); border-radius `var(--radius-field)` (:148); border-radius `var(--radius-field)` (:174); border-radius `var(--radius-field)` (:295) |
| `components/editor/SqlEditor.vue` | Continuous editor surface; shared Monaco widget styles; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/grid/DataGrid.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/grid/ExportSheet.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/grid/FilterBar.vue` | border-radius `var(--control-radius)` (:352); border-radius `var(--control-radius)` (:373); border-radius `var(--control-radius)` (:399); border-radius `var(--control-radius)` (:410) |
| `components/grid/RowIndexToggle.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/grid/ValueSheet.vue` | border-radius `999px` (:83); border-radius `var(--radius-box)` (:97) |
| `components/settings/PaletteStrip.vue` | border-radius `6px` (:65); border-radius `2px` (:79) |
| `components/settings/SettingsSheet.vue` | border-radius `var(--radius-box)` (:1070); border-radius `4px` (:1173); border-radius `999px` (:1190); border-radius `var(--control-radius)` (:1218); border-radius `var(--control-radius)` (:1307) |
| `components/settings/ShortcutSheet.vue` | border-radius `var(--radius-box)` (:330); border-radius `var(--radius-field)` (:409); border-radius `4px` (:421); border-radius `var(--radius-field)` (:446); border-radius `var(--radius-field)` (:474); border-radius `var(--radius-field)` (:492); border-radius `var(--radius-field)` (:557) |
| `components/settings/StorageSheet.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/settings/UpdateSheet.vue` | border-radius `999px` (:368); border-radius `var(--control-radius)` (:476); border-radius `var(--control-radius)` (:552) |
| `components/sidebar/ChatList.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/sidebar/ConnectionSwitcher.vue` | border-start-end-radius `0.625rem` (:307); border-end-end-radius `0.625rem` (:308); border-radius `0.4375rem` (:336); border-radius `999px` (:400); border-radius `999px` (:426) |
| `components/sidebar/DiagnoseSheet.vue` | border-radius `var(--radius-box)` (:366); border-radius `var(--radius-box)` (:477) |
| `components/sidebar/EntityTree.vue` | border-radius `0.4rem` (:728) |
| `components/sidebar/FilterChips.vue` | border-radius `999px` (:213); border-radius `0 999px 999px 0` (:270); border-radius `999px` (:298); border-radius `0.75rem` (:319); border-radius `var(--radius-field)` (:335) |
| `components/sidebar/HistoryList.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/sidebar/JobList.vue` | border-radius `var(--control-radius)` (:549); border-radius `var(--control-radius)` (:613); border-radius `calc(var(--control-radius) - 2px)` (:638); border-radius `999px` (:696) |
| `components/sidebar/SavedQueryList.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/tabs/AnalyzePanel.vue` | border-radius `var(--radius-field)` (:710); border-radius `var(--control-radius)` (:730); border-radius `var(--radius-field)` (:751); border-radius `var(--control-radius)` (:811); border-radius `var(--radius-box)` (:829); border-radius `var(--radius-box)` (:848); border-radius `var(--radius-box)` (:889); border-radius `999px` (:986) |
| `components/tabs/ContainerPropertiesSheet.vue` | border-radius `var(--radius-box)` (:303); border-radius `var(--radius-box)` (:332) |
| `components/tabs/EntityStructure.vue` | border-radius `var(--control-radius)` (:897); border-radius `var(--radius-field)` (:930); border-radius `0.3rem` (:1096); border-radius `999px` (:1138) |
| `components/tabs/ErdTab.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/tabs/ImportSheet.vue` | border-radius `var(--radius-field)` (:236); border-radius `0.5rem` (:260); border-radius `0.5rem` (:316); border-radius `0.5rem` (:325) |
| `components/tabs/JobTab.vue` | border-radius `var(--radius-field)` (:204) |
| `components/tabs/QueryTab.vue` | border-radius `var(--control-radius)` (:1166); border-radius `999px` (:1207); border-start-end-radius `0` (:1231); border-end-end-radius `0` (:1232); border-radius `var(--control-radius)` (:1246); border-radius `999px` (:1280); border-radius `var(--radius-field)` (:1408); border-start-end-radius `0` (:1452); border-end-end-radius `0` (:1453); border-radius `var(--control-radius)` (:1467); border-radius `999px` (:1501); border-radius `4px` (:1525); border-radius `var(--radius-field)` (:1535); border-radius `999px` (:1559) |
| `components/tabs/QuickDocsSheet.vue` | border-radius `var(--radius-box)` (:154); border-radius `var(--radius-field)` (:186); border-radius `999px` (:208) |
| `components/tabs/SchemaChangeSheet.vue` | border-radius `0.75rem` (:107); border-radius `0.75rem` (:124) |
| `components/tabs/TablePropertiesSheet.vue` | border-radius `var(--radius-box)` (:99); border-radius `var(--radius-box)` (:119); border-radius `var(--radius-box)` (:140) |
| `components/tabs/TableTab.vue` | border-radius `999px` (:605); border-radius `999px` (:653); border-radius `999px` (:680) |
| `components/ui/AppIcon.vue` | SVG glyph artwork; no surface radius; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/AppMark.vue` | Brand artwork owns its shape; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/CheckBox.vue` | border-radius `0.3125rem` (:83) |
| `components/ui/CircuitRing.vue` | Parent-measured radius/border drives SVG stroke path; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/ContextMenu.vue` | border-radius `0.75rem` (:210); border-radius `var(--radius-field)` (:221) |
| `components/ui/DisclosureGroup.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/FormField.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/GridSkeleton.vue` | border-radius `999px` (:82) |
| `components/ui/JsonEditor.vue` | Intentional full-page Monaco surface; floating widgets use shared monaco.css; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/NameSheet.vue` | border-radius `var(--radius-field)` (:168) |
| `components/ui/PressButton.vue` | border-radius `var(--control-radius)` (:50) |
| `components/ui/ProgressBar.vue` | No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/RangeSlider.vue` | border-radius `999px` (:77); border-radius `999px` (:91) |
| `components/ui/ResizeHandle.vue` | border-radius `999px` (:144); border-radius `999px` (:192) |
| `components/ui/SegmentedControl.vue` | border-radius `var(--seg-radius)` (:118); border-radius `calc(var(--seg-radius) - var(--seg-pad))` (:140); border-radius `calc(var(--seg-radius) - var(--seg-pad))` (:164) |
| `components/ui/SelectMenu.vue` | border-radius `var(--control-radius)` (:172) |
| `components/ui/Sheet.vue` | border-radius `1.25rem` (:620); border-radius `999px` (:719) |
| `components/ui/StatusChip.vue` | border-radius `999px` (:42) |
| `components/ui/SuggestInput.vue` | border-radius `var(--control-radius)` (:243) |
| `components/ui/TextInput.vue` | Shared `.textfield` / `.textfield--quiet` recipe; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/ui/ToggleSwitch.vue` | border-radius `999px` (:48); border-radius `inherit` (:58); border-radius `999px` (:83) |
| `components/viz/ErdCanvas.vue` | SVG node and header rx10; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/viz/ExplainTree.vue` | SVG node rx8; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/viz/LatencyTrace.vue` | Quantitative SVG rects; sample rx1; No local CSS corner declaration; parent/shared styles or surface-free content |
| `components/viz/PlanSheet.vue` | border-radius `var(--radius-box)` (:109); border-radius `var(--control-radius)` (:119) |
| `components/viz/RankedBars.vue` | border-radius `var(--radius-field)` (:116); border-radius `var(--radius-field)` (:126) |
| `components/viz/ShareDonut.vue` | border-radius `var(--radius-field)` (:209); border-radius `2px` (:223); border-radius `999px` (:247); border-radius `999px` (:258) |
| `components/viz/StatementHistogram.vue` | Square plot bars/brush; explicit control radius below; border-radius `var(--control-radius)` (:400) |
| `components/viz/ZoomControl.vue` | border-radius `calc(var(--control-radius) + var(--gap-hair))` (:74); border-radius `var(--control-radius)` (:87) |
| `views/ConnectionManager.vue` | border-radius `var(--control-radius)` (:841); border-radius `var(--control-radius)` (:873); border-radius `var(--control-radius)` (:882); border-radius `var(--radius-field)` (:914); border-radius `0` (:921); border-radius `var(--radius-field)` (:926); border-radius `var(--control-radius)` (:935); border-radius `var(--control-radius)` (:943); border-radius `var(--radius-field)` (:1002); border-radius `var(--radius-field)` (:1028); border-radius `var(--radius-field)` (:1049) |
| `views/Workspace.vue` | border-radius `0.6rem` (:992); border-radius `0.6rem` (:1008); border-radius `var(--control-radius)` (:1143); border-radius `4px` (:1162); border-radius `999px` (:1184); border-radius `var(--control-radius)` (:1212); border-radius `var(--radius-field)` (:1312); clip-path `inset(0 round var(--radius-box) 0 0 0)` (:1431); border-radius `1rem` (:1597); border-radius `var(--radius-box)` (:1651); border-radius `0.5rem` (:1678) |

## Shared stylesheet declaration inventory

| Source | Declaration |
| --- | --- |
| `styles/base.css:159` | `border-radius: var(--radius-field)` |
| `styles/base.css:183` | `border-radius: 6px` |
| `styles/controls.css:202` | `border-radius: var(--radius-field)` |
| `styles/controls.css:247` | `border-radius: var(--control-radius)` |
| `styles/controls.css:291` | `border-radius: var(--control-radius)` |
| `styles/controls.css:388` | `border-radius: 999px` |
| `styles/controls.css:439` | `border-radius: var(--control-radius)` |
| `styles/controls.css:443` | `border-start-end-radius: 0` |
| `styles/controls.css:444` | `border-end-end-radius: 0` |
| `styles/controls.css:448` | `border-start-start-radius: 0` |
| `styles/controls.css:449` | `border-end-start-radius: 0` |
| `styles/controls.css:497` | `border-radius: 999px` |
| `styles/controls.css:526` | `border-radius: var(--radius-box)` |
| `styles/controls.css:551` | `border-radius: calc(var(--radius-box) - 0.25rem)` |
| `styles/controls.css:622` | `border-radius: var(--control-radius)` |
| `styles/controls.css:678` | `border-radius: var(--control-radius)` |
| `styles/controls.css:791` | `border-radius: var(--control-radius)` |
| `styles/monaco.css:32` | `border-radius: 0 !important` |
| `styles/monaco.css:54` | `border-radius: var(--radius-box)` |
| `styles/monaco.css:91` | `border-radius: var(--radius-field)` |
| `styles/monaco.css:119` | `border-radius: var(--radius-field)` |
| `styles/monaco.css:204` | `border-radius: var(--radius-box)` |
| `styles/monaco.css:211` | `border-radius: var(--radius-field)` |
| `styles/monaco.css:215` | `border-radius: var(--radius-field)` |
| `styles/monaco.css:223` | `border-radius: 6px` |

## Literal distribution

These counts include intentional circles/joins and are not severity rankings.

| Expression | Occurrences |
| --- | --- |
| `999px` | 42 |
| `0` | 9 |
| `0.75rem` | 7 |
| `4px` | 5 |
| `0.5rem` | 5 |
| `0.6rem` | 3 |
| `0.625rem` | 3 |
| `6px` | 3 |
| `0.3rem` | 2 |
| `1rem` | 2 |
| `0.4rem` | 2 |
| `2px` | 2 |
| `1rem 1rem 0.35rem 1rem` | 1 |
| `1.1rem` | 1 |
| `1px` | 1 |
| `0.25rem` | 1 |
| `0.4375rem` | 1 |
| `0 999px 999px 0` | 1 |
| `0.3125rem` | 1 |
| `1.25rem` | 1 |
| `0 !important` | 1 |

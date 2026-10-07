# Motion and surface implementation review

Reviewed after the whole-app audit fixes, Settings/export redesign and Jobs activity work. The original audits remain historical evidence; this review records the resulting implementation.

Scope: **84 Vue components, 83 Storybook files, shared styles and process-owned interactions**. The source review follows the original component/state inventory. Runtime checks cover the regression suite and focused wide/narrow, keyboard, interruption and reduced-motion cases; this is not a claim that every possible data set and gesture was manually replayed.

| Before | After | Why |
| --- | --- | --- |
| Rapid tree collapse actions could disappear; streamed content could outrun transcript pinning | Pending actions survive interruption; pinned transcripts observe natural content growth and recheck reader position | Motion must preserve intent and keep the answer readable |
| Keyboard actions inherited pointer animation, and JavaScript animation ignored reduction | Shared input-origin and live reduced-motion policies; direct reduced-motion diagram dragging; editor scrolling/caret motion follows preferences | Repeated keyboard work stays immediate |
| Sheets and connection editors were removed on timers | Actual sheet exit completion owns removal, with interrupted exits guarded | Views survive until their objects have actually left |
| Tools moved under the pointer; filter identities, toast re-grabs and brush ownership were unstable | Stationary action boxes, stable chip identity, rendered-position re-grab and one active brush pointer | Interactions remain continuous and targets remain reachable |
| Loading veils blurred page content; chart fills animated layout | Token dimming surfaces and transformed chart fills | Preserve material rules and avoid unnecessary geometry work |
| Settings was one long form and changed size across views; JSON stopped short | Category navigation, fixed viewport-bounded frame, internal scrolling and a flexible JSON editor above its own toolbar | Use width and preserve a stable workspace |
| Export choices lacked a clear relationship to the output | Destination/format/scope alongside a bounded sample and truthful export summary | Make file versus loaded-row clipboard behavior visible |
| Comparable controls, cards and popups carried unrelated corners | Shared semantic radius tokens, role-based CSS and SVG migration | Make the same kind of object carry the same outline |
| Jobs had no persistent toolbar progress feedback | Fixed top-right target, live count tooltip, running ring, transient success check or failure warning and reduced-motion feedback | Show ongoing work without hiding failures or moving the target |

The Jobs state transition explicitly waits for **CSS transitions**, not its infinite spinner animation. Its state swap uses 140ms opacity/scale, the active ring rotates continuously only while jobs run, and completion remains visible for 2.6 seconds. The latter is a reading interval, not a long animation. Reduced motion keeps brief opacity feedback and removes rotation/scale. Focus opens its tooltip immediately; pointer hover uses the shared dwell policy. Tooltip labels update while open.

Intentional square/asymmetric exceptions remain: structural pane seams, grid cells, grouped joins, diagram header joins and precision editing surfaces. The transcript's one-pixel streaming caret is a glyph rather than a surface corner. Sheet/disclosure height transitions carry containment rather than decoration; streaming prose and data rows do not receive per-item entrance effects.

Validation: formatter, lint, renderer names/types, Node types, production build, **753 unit tests, 132 UI checks, 77 end-to-end tests and 313 Storybook stories (0 broken)**. The Settings visual baseline was reviewed before accepting it. Wide and narrow Settings/export renderings were also inspected. Focused checks exercise all Settings categories, JSON pane geometry, concurrent Jobs, partial failures, restart during feedback, live tooltip updates and reduced motion.

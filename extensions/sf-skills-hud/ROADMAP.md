# SF Skills HUD — Roadmap

This document captures follow-up work for the `sf-skills-hud` extension after
Phase 1.

Phase 1 is intentionally conservative:

- passive top-right HUD
- hidden until at least one skill is actually used
- factual detection only
  - explicit `/skill:name` invocation
  - assistant `read` of `SKILL.md`
- two states only
  - **Live**
  - **Earlier**

Phase 2 should improve control and depth without making the always-visible HUD
noisy.

## Phase 2 Goals

1. **Give the user control over the HUD surface**
   - let the user hide/show it explicitly
   - let the user pin/unpin the HUD behavior intentionally
   - keep passive mode as the default

2. **Add a richer detail view without bloating the HUD**
   - keep the top-right HUD compact
   - add a separate drill-down panel for deeper inspection

3. **Explain why a skill is shown**
   - show whether the skill was detected from an explicit invocation or from a
     `read(SKILL.md)` call
   - reduce ambiguity when multiple Salesforce skills are active

4. **Show available-but-unused skills only in detailed views**
   - do not pollute the persistent HUD
   - allow users to inspect the broader discovered skill inventory on demand

## Proposed Phase 2 Scope

### 1. Manual HUD controls

Add subcommands to `/sf-skills`:

- `/sf-skills show`
- `/sf-skills hide`
- `/sf-skills pin`
- `/sf-skills unpin`
- `/sf-skills panel`

Recommended behavior:

- `show` → make the HUD visible immediately if there is content to show
- `hide` → temporarily suppress the HUD even if skills are active
- `pin` → keep HUD mode enabled as the preferred surface for this session
- `unpin` → allow the extension to fall back to command-only/detail-only behavior
- `panel` → open the richer right-side detail panel

### 2. Right-side detail panel

Add a focusable overlay or side panel that shows grouped sections:

- **Live now**
- **Earlier in session**
- **Available**

For each skill row, show:

- skill name
- evidence badges
  - `explicit`
  - `read`
- last-seen ordering or turn-relative ordering if practical
- whether the skill is currently live or only historical

The detail panel should be:

- scrollable if needed
- safe on narrower terminals
- dismissible without affecting the passive HUD

### 3. Evidence-aware rendering

Improve the HUD and detail summary to expose detection evidence.

Examples:

- `Apex [explicit]`
- `Testing [read]`
- `Flow [explicit, read]`

For the compact HUD, evidence may be shown only when there are very few skills,
otherwise reserve this for the detail panel.

### 4. Available-but-unused skill inventory

Detailed view only.

Show discovered skills that have not yet been used in a separate section.
This should be informational, not a claim that they are loaded in context.

Suggested label:

- **Available**

Avoid labels like:

- `Loaded`
- `Planned`

unless there is stronger evidence in a later phase.

## Phase 2 Backlog Checklist

This is the suggested implementation order. These items are intentionally not
implemented yet.

### A. Session visibility controls

- [ ] Add `/sf-skills show`
- [ ] Add `/sf-skills hide`
- [ ] Add `/sf-skills pin`
- [ ] Add `/sf-skills unpin`
- [ ] Add `/sf-skills panel`
- [ ] Add session-scoped visibility state helper for hide/show/pin
- [ ] Make sure manual hide suppresses only the passive HUD
- [ ] Make sure panel mode can still open while the passive HUD is hidden

### B. Detail panel foundation

- [ ] Add `lib/detail-panel.ts`
- [ ] Choose final panel shape: right-side panel vs top-right expansion
- [ ] Add grouped panel sections for `Live now`, `Earlier in session`, and `Available`
- [ ] Add safe rendering rules for narrow terminals
- [ ] Add scrolling behavior for long skill lists
- [ ] Make panel dismiss without affecting passive HUD state

### C. Evidence-aware presentation

- [ ] Add evidence badge formatter helper
- [ ] Show `explicit` and `read` badges in the detail panel
- [ ] Decide whether compact HUD should show evidence when only 1-2 skills are visible
- [ ] Keep the persistent HUD concise when many skills are active

### D. Available inventory section

- [ ] Add discovered-but-unused skills to the detailed panel only
- [ ] Keep the persistent HUD limited to actually used skills
- [ ] Cap or paginate the `Available` section if the list becomes too tall

### E. Validation and polish

- [ ] Add tests for hide/show/pin state transitions
- [ ] Add tests for detail panel grouping and ordering
- [ ] Add tests for evidence badge formatting
- [ ] Verify correct behavior after compaction
- [ ] Verify correct behavior after `/tree` branch navigation
- [ ] Verify overlay behavior alongside other overlays
- [ ] Update README if Phase 2 ships

## Non-Goals for Phase 2

Do **not** add these yet:

- speculative “planned skills” detection
- automatic skill recommendations based on heuristics only
- global persistent settings unless there is a clear need
- a large always-visible inventory panel

These can be revisited in a later phase.

## Suggested File Additions

If Phase 2 is implemented, likely new files:

```text
extensions/sf-skills-hud/
  ROADMAP.md                 ← this file
  lib/
    detail-panel.ts          ← right-side focusable detail panel
    visibility-state.ts      ← hide/show/pin session state helpers
    evidence-format.ts       ← badge formatting + compact label helpers
  tests/
    detail-panel.test.ts     ← panel grouping + rendering tests
    visibility-state.test.ts ← hide/show/pin behavior tests
```

## Acceptance Criteria

Phase 2 is done when all of the following are true:

- user can hide/show the HUD explicitly
- user can open a richer detail panel on demand
- detail panel clearly separates:
  - live skills
  - earlier skills
  - available skills
- skill rows expose detection evidence
- passive HUD remains compact and non-disruptive
- branch switches and compaction still produce correct state
- unit tests cover the new state transitions and detail grouping

## Open Questions

These should be resolved before implementation:

1. **Should pin/unpin persist only for the current session, or also in settings?**
   - recommended default: session-only first

2. **Should hide suppress only the passive HUD, or also the detailed panel?**
   - recommended default: hide only the passive HUD

3. **Should the detail panel appear as a top-right expansion or full right-side panel?**
   - recommended default: right-side panel

4. **Should available-but-unused skills be capped or fully listed?**
   - recommended default: fully listed in the detail panel, capped in summaries

## Later Phase Ideas

Possible future work after Phase 2:

- heuristic “Suggested” section
- skill usage timeline
- branch-aware diffs of skill state
- filters for Salesforce-only vs all discovered skills
- clickable or keyboard-selectable skill rows that jump to related session context

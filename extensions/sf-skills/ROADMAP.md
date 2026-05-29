# SF Skills HUD — Roadmap

This document captures follow-up work for the `sf-skills` extension (originally `sf-skills-hud`) after
Phase 1.

Phase 1 is intentionally conservative:

- passive top-right HUD
- hidden until at least one skill is actually used
- factual detection only
  - explicit `/skill:name` invocation
  - assistant `read` of `SKILL.md`
- two states only
  - **In context**
  - **Earlier in session**

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

- **In context**
- **Earlier in session**
- **Available**

For each skill row, show:

- skill name
- evidence badges
  - `explicit`
  - `read`
- last-seen ordering or turn-relative ordering if practical
- whether the skill is currently in context or only historical

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
- [ ] Add grouped panel sections for `In context`, `Earlier in session`, and `Available`
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
extensions/sf-skills/
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
  - in-context skills
  - earlier-in-session skills
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

## Deferred: Portable Skill Manifest (export / import)

Requested by users who want to share a project's skill setup with teammates.
**Deferred** — it adds a lot of surface (git cloning, trust prompts, path
resolution, a new file format) relative to v1 value. Captured here so the
design we agreed on isn't lost.

Decisions reached (if/when revived):

- **Subordinate artifact, not a new source of truth.** A `.pi/skills.json`
  (JSON) that `export` writes and `import` compiles into the project's native
  `settings.skills[]`. `settings.skills[]` stays authoritative (Compiled Skill
  Resolution); the manifest is to it what a committed dependency spec is to an
  installed tree.
- **Sources + selection.** The manifest declares both where skills come from
  and which are enabled. Sources use a Logical Source Reference: `in-repo`
  (repo-relative path), `git` (repo URL, optionally pinned), `managed`
  (afv-library), or `harness`/`local` (machine-specific; wired only if present).
  Absolute `~/` paths are never the portable form.
- **import is explicit and confirm-gated.** Never auto-applies at boot (network
  - running unvetted skills). At most a cache-first deferred nudge when a
    `.pi/skills.json` is present. Confirms before cloning any `git` source
    (importing a manifest = running code a teammate referenced). Resolves each
    source by kind, reports missing `local` sources without failing, idempotent.
- **export** captures the current project's enabled skills, classifies each to a
  Logical Source Reference, and warns on non-portable `local` sources. Commit
  the manifest; the compiled `settings.json skills[]` stays per-machine, and a
  teammate re-imports after clone. No forced gitignore.

## Deferred: other thread asks

- **Named profiles** — switchable skill sets beyond global/project. Defer until
  there's demand; risks overlapping with the manifest above.
- **Standalone / upstream extraction** — `catalog.ts` / `resolution.ts` / the
  funnel view are domain-agnostic and could be extracted, but the natural home
  is **pi core** (it owns `settings.skills[]`), not a separate Salesforce
  extension. Park as an upstream candidate; not an sf-pi deliverable.

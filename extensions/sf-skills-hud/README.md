# SF Skills HUD — Code Walkthrough

## What It Does

Shows a persistent, passive HUD in the top-right corner once the current session
has actually used at least one skill.

The HUD splits skill usage into two honest states:

- **Live** — the skill is still represented in the active LLM context
- **Earlier** — the skill was used on the current branch, but is no longer in
  the active context after compaction or later conversation growth

If no skill usage has been detected, the HUD stays hidden.

See [ROADMAP.md](./ROADMAP.md) for planned follow-up work beyond Phase 1.

## Runtime Flow

```text
Extension loads
  ├─ session_start
  │   ├─ mount hidden non-capturing overlay
  │   └─ reconstruct live/earlier skill state from branch + active context
  ├─ message_end
  │   └─ re-scan explicit skill invocations and read(SKILL.md) calls
  ├─ session_tree
  │   └─ re-scan after branch navigation
  ├─ session_compact
  │   └─ re-scan after compaction changes what is still live
  ├─ /sf-skills
  │   └─ show text summary for the current state
  └─ session_shutdown
      └─ dismiss overlay and clear references
```

## Key Architecture Decisions

### 1. Derived state, not persisted state

The extension reconstructs skill state from:

- `pi.getCommands()` skill inventory
- `ctx.sessionManager.getBranch()` for branch history
- `buildSessionContext()` for what is still live

This avoids stale extension-local state across reload, compaction, and tree
navigation.

### 2. Passive overlay instead of footer text

The HUD uses a **non-capturing overlay** anchored to the top-right corner. That
keeps it pinned while the chat scrolls underneath, without stealing focus from
normal typing.

### 3. Conservative skill detection

Phase 1 only treats a skill as used when there is strong evidence:

- an explicit `/skill:name` invocation that expands into a skill block
- an assistant `read` tool call that opens a discovered `SKILL.md`

This keeps the HUD factual instead of heuristic.

### 4. Compaction-aware presentation

The extension does not claim a skill is still “loaded” after compaction unless
its usage is still present in the active context. Older skill usage moves to the
**Earlier** section.

## Behavior Matrix

| Event/Trigger      | Condition                                   | Result                                            |
| ------------------ | ------------------------------------------- | ------------------------------------------------- |
| `session_start`    | UI available                                | Mount passive top-right overlay and rebuild state |
| `session_start`    | no UI                                       | Stay silent                                       |
| `message_end`      | skill block or `read(SKILL.md)` now visible | Refresh HUD contents                              |
| `message_end`      | no skill usage detected                     | Keep overlay hidden                               |
| `session_tree`     | branch changed                              | Recompute live vs earlier skills                  |
| `session_compact`  | compaction completed                        | Recompute live vs earlier skills                  |
| `/sf-skills`       | any time                                    | Show textual summary via notification             |
| `session_shutdown` | —                                           | Dismiss overlay                                   |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-skills-hud/
  lib/
    hud-component.ts        ← implementation module
    skill-state.ts          ← implementation module
  tests/
    skill-state.test.ts     ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run: `npm test`

Primary tests are pure helper tests for the state reconstruction logic:

- explicit skill invocation stays **Live**
- skill reads via `read(SKILL.md)` are detected
- pre-compaction skill usage becomes **Earlier** when it falls out of context

## Troubleshooting

**HUD never appears even though I know a skill was used:**
Phase 1 is conservative — only two signals count as a skill being used:
an explicit `/skill:name` invocation, or an assistant `read` tool call
that opens a discovered `SKILL.md`. Indirect mentions or heuristic
matches intentionally don't trigger the HUD.

**A skill moved from Live to Earlier mid-session:**
Expected. After a compaction or significant context growth, the HUD no
longer claims a skill is "live" unless its usage is still present in
the active context. Use `/sf-skills` to see the current summary.

**HUD doesn't update after switching branches with `/tree`:**
It should — `session_tree` events trigger a state rebuild. If you see
stale state, run `/sf-skills` to force a recompute. File an issue with
a repro; derived-state reconstruction is designed to avoid this class
of bug.

**I want the HUD off or a richer view:**
Phase 2 will add `/sf-skills show|hide|pin|unpin|panel`. See
[`ROADMAP.md`](./ROADMAP.md) for the phased plan.

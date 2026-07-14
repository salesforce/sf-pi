# SF Herdr — Code Walkthrough

## What It Does

SF Herdr is an experimental Salesforce-aware planning layer for Herdr. It owns
managed workflow profiles, branch-scoped workflow signals, status/doctor
surfaces, and a non-mutating lane planner for dynamic Herdr workflows.

It does **not** replace [`npm:@ogulcancelik/pi-herdr`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-herdr).
The upstream package still provides the actual `herdr` tool. SF Herdr only plans
how the agent should use that tool.

## Runtime Flow

```
Extension loads
  ├─ registers /sf-herdr before optional planner-tool wiring
  ├─ lazily contributes sf_herdr_plan after session_start/resources_discover
  ├─ session_start/session_tree reconstruct branch workflow signals
  ├─ tool_execution_end/tool_result observe fresh workflow signals
  └─ /sf-herdr opens SF Herdr in the SF Pi Manager; subcommands stay direct

sf_herdr_plan
  ├─ reads managed workflow profiles from <globalAgentDir>/sf-pi/herdr/preferences.json
  ├─ infers primary + related workflow from recent branch signals when omitted
  ├─ maps intent to a Dynamic Herdr Lane
  └─ returns alias/action/cleanup guidance without mutating panes
```

## Key Architecture Decisions

- SF Herdr follows [ADR 0016](../../docs/adr/0016-dynamic-sf-herdr-lane-planning.md): hybrid orchestration with explicit upstream `herdr` calls.
- `sf_herdr_plan` is non-mutating and never generates shell commands.
- Planner-tool registration is lazy/fail-soft so `/sf-herdr` remains available even if optional tool wiring cannot load.
- Dynamic lanes are command-scoped and activity-informed, not session-scoped. Workflow signals may select a profile, but they never justify opening panes by themselves.
- Fresh Ephemeral Lanes are created just in time as split panes from the current agent/orchestrator pane with suffixed aliases and stop/close after the workflow success condition.
- Existing ephemeral panes are not reused; `herdr(action="list")` is used for alias collision detection, not reuse.
- Failed, timed out, or ambiguous Fresh Ephemeral Lanes stay open after recent-output summarization until the user chooses cleanup.
- Managed preferences live in the shared profile store at `lib/common/herdr-profile/store.ts` so SF Brain can later read compact profile summaries without importing this extension.
- `sf-guardrail` mediates `herdr.run.command` through the same safety gates as `bash.command`.

## Behavior Matrix

| Event/Trigger      | Condition                              | Result                                                        |
| ------------------ | -------------------------------------- | ------------------------------------------------------------- |
| extension load     | pi version supported                   | Register `/sf-herdr`; no Herdr probe                          |
| session_start      | —                                      | Reconstruct branch workflow signals; register `sf_herdr_plan` |
| session_tree       | branch changes                         | Reconstruct workflow signals from active branch               |
| tool_execution_end | recognized SF Pi tool or Herdr command | Record workflow signal                                        |
| tool_result        | write/edit or custom tool result       | Record workflow signal                                        |
| session_shutdown   | —                                      | Clear in-memory signal state                                  |
| /sf-herdr          | UI available                           | Open SF Herdr in the SF Pi Manager                            |
| /sf-herdr status   | any                                    | Show Herdr runtime, profiles path, inferred workflow          |
| /sf-herdr doctor   | any                                    | Show readiness notes                                          |
| /sf-herdr profiles | any                                    | Print managed workflow profile summary                        |
| /sf-herdr reset    | any                                    | Reset managed workflow profiles to bundled defaults           |
| /sf-herdr settings | UI available                           | Open SF Herdr settings in the SF Pi Manager                   |
| sf_herdr_plan      | intent provided                        | Return a non-mutating lane plan with action hints             |

## Commands

| Command              | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `/sf-herdr`          | Open SF Herdr in the SF Pi Manager.                                                  |
| `/sf-herdr status`   | Show runtime status, profile path, and inferred workflow signals.                    |
| `/sf-herdr doctor`   | Show readiness notes for Herdr control, passive bridge, profiles, and planner state. |
| `/sf-herdr profiles` | Print managed workflow profile summary.                                              |
| `/sf-herdr reset`    | Reset workflow profiles to bundled defaults.                                         |
| `/sf-herdr settings` | Open SF Herdr settings in the SF Pi Manager.                                         |
| `/sf-herdr help`     | Print v1 usage and boundaries.                                                       |

## Agent Tool

| Tool            | Purpose                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `sf_herdr_plan` | Plan a Dynamic Herdr Lane for a Salesforce workflow intent. Non-mutating; returns phased guidance, action hints, and cleanup policy only. |

## Dynamic Lane Lifecycle

- `ephemeral`: create a fresh split pane from the current agent/orchestrator pane immediately before `herdr(action="run")`; choose a short-id suffixed alias that has not already been used in the session after checking `herdr(action="list")` for live collisions; stop/close with `herdr(action="stop")` only after the workflow success condition.
- `sticky`: reuse the base alias when it already exists, or create it just in time when absent, such as dev servers. Do not use sticky lanes as a reason to pre-open panes.
- `manual`: reuse the base alias when it already exists, or create it just in time when absent; never auto-close unless the user asks.

Apex log tails use a Fresh Ephemeral Lane derived from the `apex_logs` base alias by default: open the lane only when starting the tail/log command, watch/read the expected marker, then stop/close the lane on success. Omit `pane` on `herdr(action="pane_split")` to split the current agent/orchestrator pane; pass `pane` only when the user asks for a source pane or a simultaneous lane must split from a worker pane to protect layout.

## Managed Preferences

Stored at:

```text
<globalAgentDir>/sf-pi/herdr/preferences.json
```

The file is managed through **SF Pi Manager → SF Herdr → Settings** or directly
with `/sf-herdr settings` in TUI mode. The settings panel marks unsaved changes,
uses a bullet beside changed fields, and writes only after `S` or `Enter`.
Saving stays on the settings page and changes the status back to `Saved`; `Esc`
/ `q` leaves the page, discarding only unsaved drafts. The panel exposes the
minimal workflow lane controls: split direction, workflow, lane, and lane
lifecycle (`ephemeral`, `sticky`, or `manual`). The JSON file is recoverable,
but not positioned as a primary hand-editable Pi setting.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-herdr/
  lib/
    config-panel.ts         ← implementation module
    sf_herdr_plan-tool.ts   ← implementation module
    signal-state.ts         ← implementation module
    status.ts               ← implementation module
  tests/
    config-panel.test.ts    ← unit / smoke test
    plan-render.test.ts     ← unit / smoke test
    signal-state.test.ts    ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted checks while iterating:

```bash
npm test -- lib/common/tests/herdr-profile.test.ts extensions/sf-herdr/tests/signal-state.test.ts
npm run check -- --pretty false
```

## Troubleshooting

**`/sf-herdr` is not available in the slash-command list:**
Reload or restart Pi after updating SF Pi so the extension registry is rebuilt.
You can still use the generic deep link `/sf-pi open sf-herdr` when the manager
is available. If the command remains missing after reload, confirm SF Herdr is
enabled in `/sf-pi` and not excluded by a package filter.

**`sf_herdr_plan` says generic workflow:**
The branch has few or no recent workflow signals. Pass `primaryWorkflow` explicitly or continue the workflow until SF Herdr observes more tool/file activity.

**Herdr is not available:**
Install and run Pi inside Herdr with the upstream package:

```bash
pi install npm:@ogulcancelik/pi-herdr
```

SF Herdr can still show status and preferences outside Herdr, but actual pane orchestration requires the upstream `herdr` tool to be active.

**A lane stayed open:**
Ephemeral lanes intentionally stay open on failure or timeout for inspection, then require an explicit cleanup decision. Sticky and manual lanes are not auto-closed by plan guidance.

**The main pane was shrunk too much:**
Do not create multiple simultaneous splits from the orchestrator pane. Reuse an existing worker lane when possible, split from a worker pane instead of the orchestrator, or use a tab for the second simultaneous lane.

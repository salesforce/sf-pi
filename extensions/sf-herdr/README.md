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
  ├─ registers /sf-herdr
  ├─ contributes sf_herdr_plan after session_start
  ├─ session_start/session_tree reconstruct branch workflow signals
  ├─ tool_execution_end/tool_result observe fresh workflow signals
  └─ /sf-herdr opens SF Herdr in the SF Pi Manager; subcommands stay direct

sf_herdr_plan
  ├─ reads managed workflow profiles from <globalAgentDir>/sf-pi/herdr/preferences.json
  ├─ infers primary + related workflow from recent branch signals when omitted
  ├─ maps intent to a Dynamic Herdr Lane
  └─ returns discover/create/run/observe/cleanup guidance without mutating panes
```

## Key Architecture Decisions

- SF Herdr follows [ADR 0016](../../docs/adr/0016-dynamic-sf-herdr-lane-planning.md): hybrid orchestration with explicit upstream `herdr` calls.
- `sf_herdr_plan` is non-mutating and never generates shell commands.
- Dynamic lanes are command-scoped and activity-informed, not session-scoped. Workflow signals may select a profile, but they never justify opening panes by themselves.
- Ephemeral lanes are created just in time for the command/tool being run and closed after successful watched completion.
- Ephemeral lanes prefer split panes because the upstream `herdr` tool exposes pane close (`stop`) but not an explicit tab-close action; plans tell agents not to stack multiple splits off the main orchestrator pane.
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
| sf_herdr_plan      | intent provided                        | Return a non-mutating lane plan                               |

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

| Tool            | Purpose                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `sf_herdr_plan` | Plan a Dynamic Herdr Lane for a Salesforce workflow intent. Non-mutating; returns phased guidance only. |

## Dynamic Lane Lifecycle

- `ephemeral`: create just in time immediately before `herdr.run`; close with `herdr.stop` after successful watched completion; preserve on failure or timeout only long enough for inspection.
- `sticky`: keep open for reuse, such as dev servers. Do not use sticky lanes as a reason to pre-open panes.
- `manual`: never auto-close unless the user asks.

Apex log tails use an ephemeral `apex_logs` lane by default: open the lane only when starting the tail/log command, watch/read the expected marker, then interrupt/stop the tail and close the lane on success. Avoid splitting the main orchestrator pane more than once or shrinking it below roughly half the tab; reuse an existing worker lane or choose a tab when a second simultaneous lane is unavoidable.

## Managed Preferences

Stored at:

```text
<globalAgentDir>/sf-pi/herdr/preferences.json
```

The file is managed through **SF Pi Manager → SF Herdr → Settings** or directly
with `/sf-herdr settings` in TUI mode. The settings panel marks unsaved changes,
uses a bullet beside changed fields, and writes only after `S` or `Enter`.
Saving stays on the settings page and changes the status back to `Saved`; `Esc`
/ `q` leaves the page, discarding only unsaved drafts. The JSON file is
recoverable, but not positioned as a primary hand-editable Pi setting.

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

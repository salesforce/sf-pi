# SF Herdr

## What It Does

SF Herdr adds a non-mutating Salesforce workflow planner for the upstream
`herdr_layout`, `herdr_pane`, and `herdr_agent` tools. `/sf-herdr` always
provides status, doctor, settings, and help. The `sf_herdr_plan` tool registers
at session start only when Pi is running inside Herdr and all three upstream
tools are active.

The separate official Herdr skill remains owned and distributed by Herdr. SF Pi
neither bundles nor rewrites it.

## Commands

| Command              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `/sf-herdr`          | Open SF Herdr in the Manager                    |
| `/sf-herdr status`   | Show environment, tool readiness, and settings  |
| `/sf-herdr doctor`   | Check the Herdr environment and all three tools |
| `/sf-herdr settings` | Open global lifecycle settings                  |
| `/sf-herdr help`     | Print usage and boundaries                      |

## Configuration

Global settings live under `sfPi.herdr`:

- `splitDirection`: `auto`, `right`, or `down`;
- `lifecycleByIntent`: `ephemeral`, `sticky`, or `manual` for each supported
  Salesforce workflow intent.

`ephemeral` closes only a freshly created pane after observed success. `sticky`
and `manual` retain it. Failure, timeout, blocked, or ambiguous results always
leave the pane open for inspection.

## Safety and Data Boundaries

- `sf_herdr_plan` returns plans only; it never creates panes or generates shell
  commands.
- Plans use only current Herdr tool/action pairs and pass opaque pane IDs returned
  by layout operations.
- Ordinary commands belong to `herdr_pane`; recognized coding-agent interaction
  belongs to `herdr_agent`.
- SF Guardrail still mediates dangerous or org-aware `herdr_pane.run` commands.
- The planner normalizes the current successful empty-body pane-run result
  without retrying a command that may already have executed.

## Troubleshooting

**`sf_herdr_plan` is unavailable:** Start Pi inside a Herdr pane and verify
`/sf-herdr doctor`. Registration is a session-start decision, so restart Pi after
repairing the environment.

**An ephemeral pane stayed open:** Inspect it. SF Herdr closes only after
observed success and intentionally leaves failed, blocked, timed-out, or
ambiguous panes available.

**The Herdr package is missing:** Install `npm:@ogulcancelik/pi-herdr`. The
separate official skill remains a Herdr-owned installation.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-herdr/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

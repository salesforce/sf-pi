# SF Brain — Code Walkthrough

## What It Does

Injects the **Salesforce Operator Kernel** into the session exactly once, on the
first agent turn. It also injects a small **SF Pi extension context** whenever
the bundled-extension state or active tool/skill set changes, so agents know
which SF Pi workflows are enabled, disabled, or unavailable in the current
session.

The kernel is a compact, CLI-focused system-prompt add-on that teaches the
agent:

1. **Retrieve before edit, describe before query** — the single biggest
   foot-gun with Salesforce LLM workflows.
2. **A 5-question API picker** — Data vs Tooling vs Metadata vs Composite vs
   Anonymous Apex.
3. **`sf org api` as the universal REST tool** — replaces hand-rolled curl.
4. **API-version pinning** from the injected `<sf_environment>` block.
5. **`--json` + `jq`** — CLI deprecation policy protects JSON output only.
6. **Name the org explicitly on destructive calls** with `-o <alias>`.
7. **Anonymous Apex as the primary verification tool** — a verification loop
   (`sf apex run --file` → `sf apex get log --number 1`) with concrete patterns
   for Flow invocation, schema probes, Savepoint/rollback rehearsals, and
   Queueable/Batch kick-offs.
8. **Power moves** — `sf project deploy preview/validate`, `sf org list limits`,
   reading ApexClass bodies from the org via Tooling queries, deep-linking into
   Setup with `sf org open --path`.
9. **Org safety** — production confirmation gate, auth-error handling.
10. **Extension-first routing** — use enabled SF Pi extension workflows before
    generic skills or raw CLI, and suggest `/sf-pi enable <id>` when the
    best-fit extension is disabled.
11. **Lazy reference map guidance** for choosing the smallest SF Pi or Salesforce
    source of truth when the kernel is not enough.
12. **CLI install guidance** if `sf --version` fails.

The companion `<sf_pi_extensions>` block is built from the generated extension
registry, project/global package filter state, and Pi's selected tools/skills
for the turn. It lists every bundled extension with its enabled/disabled state,
intent, commands, providers, and active or inactive LLM tools. When the active
`npm:@ogulcancelik/pi-herdr` control path is available — the current session is
running inside a Herdr-managed pane and the `herdr` tool is active — it also
includes compact Herdr Workflow Mode guidance for pane orchestration. The
separate `herdr-agent-state.ts` socket bridge is passive Herdr → Pi status
reporting and is not required for this guidance.

The always-injected kernel body lives in [`SF_KERNEL.md`](./SF_KERNEL.md).
Broader SF Pi and Salesforce routing guidance lives in
[`SF_REFERENCE_MAP.md`](./SF_REFERENCE_MAP.md) and is read only when needed.
Users can override the injected kernel by creating
`<globalAgentDir>/sf-brain/SF_KERNEL.md`.

## Runtime Flow

```
Extension loads
  └─ before_agent_start handler registered

First user prompt of the session
  └─ before_agent_start fires
      ├─ kernel path
      │   ├─ session entries already contain a sf-brain-kernel custom entry? → skip
      │   ├─ else resolve SF environment (shared cache from sf-devbar / sf-welcome)
      │   ├─ CLI installed?
      │   │   ├─ yes → load bundled kernel or user override from disk
      │   │   └─ no  → load the install stub
      │   └─ inject as a persistent hidden message (customType: sf-brain-kernel)
      └─ extension context path
          ├─ build <sf_pi_extensions> from registry + package filter + selected tools/skills
          ├─ if Herdr pane env + selected tool are active, add compact Herdr Workflow Mode guidance
          ├─ live matching context entry already exists? → skip
          └─ inject as a persistent hidden message (customType: sf-pi-extensions-context)

Subsequent turns in the same session
  └─ before_agent_start fires
      ├─ kernel entry exists → skip
      └─ extension context unchanged → skip; changed → inject fresh context

/reload or /resume
  └─ session entries persist → kernel already present → skip
```

## Why a Custom Message, Not a Per-Turn System Prompt Mutation

- The kernel is static within a session. Injecting it once means providers cache
  the same bytes turn after turn (big prompt-cache wins on Anthropic / OpenAI).
- Session replays (`/resume`, `/fork`, `/reload`) inherit the entry from the
  session store — no re-detection, no drift.
- It participates in the transcript alongside `<sf_environment>` and
  Slack context, so `/tree` navigation doesn't strand it.

## Why Deferred Until `before_agent_start`, Not `session_start`

- SF environment detection is async. Injecting at `session_start` races the
  shared cache populated by sf-devbar and sf-welcome.
- `before_agent_start` always has a `ctx.sessionManager` with the final entry
  list, so the "inject once" guard is reliable.

## Behavior Matrix

| Event              | Condition                               | Result                                |
| ------------------ | --------------------------------------- | ------------------------------------- |
| before_agent_start | kernel entry already in session         | skip                                  |
| before_agent_start | CLI installed, no kernel entry yet      | inject full kernel as hidden message  |
| before_agent_start | CLI not installed, no kernel entry yet  | inject install stub as hidden message |
| before_agent_start | extension context unchanged             | skip                                  |
| before_agent_start | extension context changed or missing    | inject fresh extension context        |
| before_agent_start | Herdr pane env and `herdr` tool active  | include Herdr Workflow Mode guidance  |
| before_agent_start | Herdr pane env or `herdr` tool inactive | omit Herdr guidance; normal fallback  |

## User Override

Create `<globalAgentDir>/sf-brain/SF_KERNEL.md` (typically `~/.pi/agent/sf-brain/SF_KERNEL.md`)
to replace the bundled kernel. The override is loaded verbatim when the sf CLI
is installed; the install stub is always used when the CLI is missing, even if
an override exists. If the override is empty or unreadable, sf-brain falls back
to the bundled kernel silently.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-brain/
  lib/
    extension-context.ts    ← implementation module
    kernel.ts               ← implementation module
  tests/
    extension-context.test.ts← unit / smoke test
    injection.test.ts       ← unit / smoke test
    kernel.test.ts          ← unit / smoke test
    reference-map.test.ts   ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  SF_KERNEL.md              ← supporting file
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run: `npm test`

Covered by unit tests:

- `loadKernel({ cliInstalled: true })` returns the bundled kernel body with the
  correct header.
- `loadKernel({ cliInstalled: false })` returns the short install stub,
  independent of any user override.
- A user override at `<globalAgentDir>/sf-brain/SF_KERNEL.md` replaces the
  bundled body when CLI is installed, and is ignored when CLI is missing.
- The injected kernel points to `SF_REFERENCE_MAP.md` without inlining the full
  map.
- The extension context lists every bundled extension, reflects project-scoped
  disabled filters, marks active AgentScript tools, and tells agents to suggest
  `/sf-pi enable <id>` for disabled best-fit extensions.
- Herdr Workflow Mode appears only when strict activation succeeds: `HERDR_ENV`
  and `HERDR_PANE_ID` identify a managed pane, and `herdr` is an active tool.
- The reference map routes user intent to repo-local Salesforce resources,
  extension-first workflows, and active SF skills.
- The `before_agent_start` handler is a no-op if a `sf-brain-kernel` entry
  already exists in the session, and injects a hidden message otherwise.

## Troubleshooting

**Kernel never appears in the prompt:**

- Confirm the extension is enabled: `/sf-pi list` should show `sf-brain` as
  enabled.
- Confirm the sf CLI is on PATH: `sf --version`. If the CLI is missing,
  sf-brain injects the install stub, not the full kernel.
- If the extension loaded on a session that had a prior kernel entry, the
  injection is skipped by design. Start a new session with `/new`.

**User override does not take effect:**

- Path must be exactly `<globalAgentDir>/sf-brain/SF_KERNEL.md`. On the default
  CLI that resolves to `~/.pi/agent/sf-brain/SF_KERNEL.md`.
- The file must be non-empty. Empty overrides silently fall back to the bundled
  kernel.
- Start a fresh session with `/new` after changing the override. `/reload` keeps
  the existing live kernel entry by design.

**I want to see the kernel content in a session:**

- The kernel and extension context are injected with `display: false`, so they
  do not render in the transcript. Open the session JSONL file and look for
  custom entries with `customType: sf-brain-kernel` or
  `customType: sf-pi-extensions-context`.

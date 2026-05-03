# SF Brain — Code Walkthrough

## What It Does

Injects the **Salesforce Operator Kernel** into the session exactly once, on the
first agent turn. The kernel is a compact, CLI-focused system-prompt add-on
that teaches the agent:

1. **Retrieve before edit, describe before query** — the single biggest
   foot-gun with Salesforce LLM workflows.
2. **A 5-question API picker** — Data vs Tooling vs Metadata vs Composite vs
   Anonymous Apex.
3. **`sf org api` as the universal REST tool** — replaces hand-rolled curl.
4. **API-version pinning** from the injected `[Salesforce Environment]` block.
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
10. **Defer to loaded `sf-*` skills** for language-specific work.
11. **CLI install guidance** if `sf --version` fails.

The kernel body is the single source of truth in [`SF_KERNEL.md`](./SF_KERNEL.md).
Users can override it by creating `<globalAgentDir>/sf-brain/SF_KERNEL.md`.

## Runtime Flow

```
Extension loads
  └─ before_agent_start handler registered

First user prompt of the session
  └─ before_agent_start fires
      ├─ session entries already contain a sf-brain-kernel custom entry? → skip
      ├─ else resolve SF environment (shared cache from sf-devbar / sf-welcome)
      ├─ CLI installed?
      │   ├─ yes → load bundled kernel or user override from disk
      │   └─ no  → load the install stub
      └─ inject as a persistent hidden message (customType: sf-brain-kernel)

Subsequent turns in the same session
  └─ before_agent_start fires
      └─ entry exists → skip

/reload or /resume
  └─ session entries persist → kernel already present → skip
```

## Why a Custom Message, Not a Per-Turn System Prompt Mutation

- The kernel is static within a session. Injecting it once means providers cache
  the same bytes turn after turn (big prompt-cache wins on Anthropic / OpenAI).
- Session replays (`/resume`, `/fork`, `/reload`) inherit the entry from the
  session store — no re-detection, no drift.
- It participates in the transcript alongside `[Salesforce Environment]` and
  Slack context, so `/tree` navigation doesn't strand it.

## Why Deferred Until `before_agent_start`, Not `session_start`

- SF environment detection is async. Injecting at `session_start` races the
  shared cache populated by sf-devbar and sf-welcome.
- `before_agent_start` always has a `ctx.sessionManager` with the final entry
  list, so the "inject once" guard is reliable.

## Behavior Matrix

| Event              | Condition                              | Result                                |
| ------------------ | -------------------------------------- | ------------------------------------- |
| before_agent_start | kernel entry already in session        | skip                                  |
| before_agent_start | CLI installed, no kernel entry yet     | inject full kernel as hidden message  |
| before_agent_start | CLI not installed, no kernel entry yet | inject install stub as hidden message |

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
    kernel.ts               ← implementation module
  tests/
    injection.test.ts       ← unit / smoke test
    kernel.test.ts          ← unit / smoke test
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
- Restart pi or run `/reload`.

**I want to see the kernel content in a session:**

- The kernel is injected with `display: false`, so it does not render in the
  transcript. Open the session JSONL file and look for a custom entry with
  `customType: sf-brain-kernel`.

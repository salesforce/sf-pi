# SF LSP — Code Walkthrough

## What It Does

Provides real-time Language Server Protocol diagnostics to the agent after every
file write or edit, plus three user-facing TUI surfaces.

When the agent creates or modifies an Apex class, LWC component, or Agent
Script file, sf-lsp sends it to the appropriate LSP server and appends
diagnostic feedback directly to the tool result. This means the agent sees
compile errors immediately — before moving on to the next task — and can
self-correct in the same turn.

The UI layer is pure presentation: **nothing extra is sent to the LLM** beyond
the existing `LSP feedback: …` text block. See [`ROADMAP.md`](./ROADMAP.md)
for shipped phases and future work.

**Why no in-card panel on the edit/write tool itself?** Pi refuses to load any
extension that re-registers a tool name already claimed by another extension
(see `detectExtensionConflicts` in `resource-loader`). Third-party extensions
like `pi-tool-display` already own the `edit`/`write` names for rendering
purposes, so sf-lsp stays out of that lane and communicates via the
transcript row and the permanent sf-devbar top-bar LSP segment.

## TUI Surfaces

| Surface                 | What it shows                                                                                       | Pi primitive                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Working indicator       | `⠋ LSP Apex…` spinner while diagnostics are being fetched (≤6s)                                     | `ctx.ui.setWorkingIndicator`                                                      |
| **Top-bar LSP segment** | Permanent right-aligned `Apex: ✓ \| LWC: ◐ \| AgentScript: ●` inside sf-devbar. Glyph legend below. | `lib/common/sf-lsp-health` shared registry → sf-devbar top-bar widget             |
| Inline transcript row   | `[sf-lsp] Apex · Foo.cls · clean · 312ms` — user-only, **never** reaches the LLM                    | `pi.sendMessage({customType:"sf-lsp", display:true})` + `registerMessageRenderer` |
| Rich `/sf-lsp` panel    | Doctor + recent activity ring + actions (refresh, verbose toggle, shut down servers)                | `ctx.ui.custom` overlay with `DynamicBorder` + `SelectList`                       |

**Agent Script note:** when the `sf-agentscript-assist` extension is loaded,
sf-lsp yields `.agent` files to it. That extension handles the same diagnostic
flow in-process via the vendored Agent Script SDK — faster, richer, and with
deterministic quick fixes. sf-lsp still observes the metadata the assist
extension stamps onto the tool result so the transcript stays accurate for
`.agent` edits.

If `sf-agentscript-assist` is disabled, sf-lsp's subprocess LSP path
continues to handle `.agent` files exactly as before.

## Supported Languages

| Language     | File Extensions                    | LSP Server                 |
| ------------ | ---------------------------------- | -------------------------- |
| Apex         | `.cls`, `.trigger`                 | Apex jorje (Java)          |
| LWC          | `.js`, `.html` (in `lwc/` bundles) | lwc-language-server (Node) |
| Agent Script | `.agent`                           | Agent Script LSP (Node)    |

## Runtime Flow

```
session_start
  └─ doctor probe (background) → write sf-lsp-health registry
                                  → sf-devbar top bar repaints green/red dots

write/edit tool completes
  │
  ├─ Is this a supported Salesforce file?
  │    .cls / .trigger → Apex
  │    lwc/*/*.js|html → LWC
  │    .agent → Agent Script
  │    other → skip
  │
  ├─ Discover LSP server
  │    env vars → .pi/lsp/ → ~/.pi/agent/lsp/ → VS Code extensions → PATH
  │
  ├─ Send file to LSP, wait ≤6s for diagnostics (working indicator ticks)
  │
  └─ Decide what to append / emit:
       Has errors?           → "LSP feedback: MyClass.cls\n- L11: …" (to LLM)
                              + transcript row (user-only)
       Was error, now clean? → "LSP now clean: MyClass.cls" + transcript row
       First time unavailable? → "LSP setup note: …" + transcript row
       Clean and was never broken? → nothing (silent)
```

## LSP Server Discovery

Each language has its own discovery chain. The first match wins.

### Apex

1. `SF_LSP_APEX_JAR` or `APEX_LSP_JAR` environment variable
2. `.pi/lsp/apex/apex-jorje-lsp.jar` (project-level)
3. `~/.pi/agent/lsp/apex/apex-jorje-lsp.jar` (global)
4. VS Code Salesforce Apex extension (`salesforcedx-vscode-apex-*`)

Requires Java 11+ (`JAVA_HOME` or auto-discovered).

### Agent Script

1. `SF_LSP_AGENTSCRIPT_SERVER` or `AGENTSCRIPT_LSP_SERVER` env var
2. `.pi/lsp/agentscript/server.mjs` or `server.js` (project-level)
3. `~/.pi/agent/lsp/agentscript/server.mjs` or `server.js` (global)
4. VS Code Agent Script extension (`agent-script-language-client-*`)

Requires Node.js 18+.

### LWC

1. `SF_LSP_LWC_COMMAND` environment variable
2. `.pi/lsp/bin/lwc-language-server` (project-level)
3. `~/.pi/agent/lsp/bin/lwc-language-server` (global)
4. `lwc-language-server` on PATH

## Commands & Controls

| Command                           | Description                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `/sf-lsp`                         | Open the rich status & controls panel (doctor, recent activity, actions)               |
| `/sf-lsp doctor`                  | Compact doctor report via `ui.notify`                                                  |
| `/sf-lsp verbose on\|off\|toggle` | Flip transcript rows between balanced (errors + transitions) and verbose (every check) |

No keyboard shortcut, no CLI flag, no overlay toggle — the LSP segment is
always-on in the sf-devbar top bar and requires no configuration.

## Behavior Matrix

### LLM-facing (unchanged)

| Event/Trigger            | Condition                                       | Result                                     |
| ------------------------ | ----------------------------------------------- | ------------------------------------------ |
| session_start            | always                                          | Reset LSP session state                    |
| session_shutdown         | always                                          | Reset state, shut down LSP child processes |
| tool_result (write/edit) | `.agent` + `sf-agentscript-assist` installed    | Silent (assist extension handles it)       |
| tool_result (write/edit) | Supported SF file, has errors                   | Append `LSP feedback:` with diagnostics    |
| tool_result (write/edit) | Supported SF file, was error → now clean        | Append `LSP now clean:`                    |
| tool_result (write/edit) | Supported SF file, LSP unavailable (first time) | Append `LSP setup note:`                   |
| tool_result (write/edit) | Supported SF file, clean (no previous error)    | Silent — no modification                   |
| tool_result (write/edit) | Unsupported file                                | Silent — no modification                   |
| tool_result (error)      | Any file                                        | Silent — don't diagnose failed writes      |

### TUI-facing (user-only)

| Surface                   | Event/Trigger                                    | Result                                                                 |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| Working indicator         | check started / finished                         | Push `⠋ LSP <Lang>…` / restore default                                 |
| sf-devbar top-bar LSP     | session_start doctor probe / `/sf-lsp doctor`    | Green dot for available language, red for unavailable, dim for unknown |
| Transcript row (balanced) | error, error→clean transition, first unavailable | Emit one `sf-lsp` custom message                                       |
| Transcript row (verbose)  | every check                                      | Emit one `sf-lsp` custom message                                       |
| `/sf-lsp`                 | no args                                          | Open rich panel (doctor + recent + actions)                            |
| `/sf-lsp doctor`          | —                                                | `ui.notify` with availability report                                   |

## File Structure

```
extensions/sf-lsp/
  index.ts                ← entry point: events, commands, wiring
  manifest.json           ← metadata
  README.md               ← this file
  ROADMAP.md              ← shipped + planned phases
  lib/
    types.ts              ← LspDiagnostic, LspDoctorStatus, LspResult, SupportedLanguage
    file-classify.ts      ← file → language mapping, path resolution
    lsp-client.ts         ← LSP engine (discovery, spawn, diagnose, shutdown)
    feedback.ts           ← red/green decision logic, rendering, LLM-facing contract
    activity.ts           ← pure activity store (per-language entries, ring buffer)
    working-indicator.ts  ← ref-counted setWorkingIndicator helper
    transcript.ts         ← custom message renderer + emit policy
    panel.ts              ← /sf-lsp rich overlay (DynamicBorder + SelectList)
    settings-io.ts        ← persistent sfPi.sfLsp.verbose
  tests/
    smoke.test.ts         ← module export check
    file-classify.test.ts ← file classification and path resolution
    feedback.test.ts      ← red/green logic and LLM text rendering
    activity.test.ts      ← pure activity store transitions
    transcript.test.ts    ← shouldEmitTranscriptRow policy
```

Shared with sf-devbar:

```
lib/common/sf-lsp-health/
  index.ts                ← in-process health registry (available/unavailable/unknown)
  types.ts                ← SupportedLspLanguage + languageFullName helper
  tests/health.test.ts    ← mutation + subscription tests
```

## Memory Management

Adopted from lsp-pi best practices:

- **LRU file eviction**: Max 30 open files per LSP server. When exceeded, the
  least-recently-accessed file is closed.
- **Idle file cleanup**: Files not accessed for 60s are automatically closed.
- **Idle server shutdown**: Servers with no activity for 2 minutes are shut down.
  They restart lazily when the next file is diagnosed.
- **Path normalization**: Uses `realpathSync` to handle macOS `/var` vs `/private/var`.

## Testing Strategy

- **file-classify.ts**: Pure functions, fully tested with edge cases
- **feedback.ts**: Pure decision logic and rendering, tested with factory helpers
- **lsp-client.ts**: Requires real LSP servers — tested via manual QA with
  `/sf-lsp doctor` and actual file edits against a connected org
- **activity.ts**: Pure state transitions, fully tested

Run: `npm test`

## Troubleshooting

**Top-bar LSP glyph legend:**

| Glyph | Color         | Meaning                                                  |
| ----- | ------------- | -------------------------------------------------------- |
| `◌`   | dim           | Not probed yet (first ~100ms after `session_start`)      |
| `○`   | warning, bold | LSP jar / server / binary missing — see `/sf-lsp doctor` |
| `●`   | success       | LSP is installed and ready; no check has run yet         |
| `◐`   | accent, bold  | A diagnostic check is running right now                  |
| `✓`   | success, bold | The most recent check came back clean                    |
| `✗`   | error, bold   | The most recent check reported errors                    |

Shape alone disambiguates on terminals with color fallback.

**The sf-devbar top-bar LSP segment stays `◌` (dotted circle) after a while:**
Run `/sf-lsp doctor` to kick a fresh probe. If a language stays dotted,
sf-devbar isn't subscribed (check `/sf-devbar` is enabled and loaded)
— the segment is rendered by sf-devbar using the shared
`lib/common/sf-lsp-health` registry that sf-lsp writes into on
`session_start` and on every check.

**Transcript rows feel too chatty / too quiet:**
Default mode is balanced: transcript row only on errors, red-to-green
transitions, and the first unavailable per language per session. Use
`/sf-lsp verbose on` to emit one row per check, or `/sf-lsp verbose off`
to go back to balanced. Setting persists to global Pi settings.

**Working indicator keeps saying `LSP Apex…` after the turn ends:**
The indicator is reference-counted around every `getLspDiagnosticsForFile`
call. If a parallel tool-call chain leaks, run any command that triggers
a new turn — Pi restores the default indicator on `turn_start`. File a
bug with a repro if it persists; the counter resets on `session_shutdown`.

**`LSP setup note:` appears once per file type and then stays silent:**
No LSP server was discovered for that language. Run `/sf-lsp doctor` for
the full availability report and the discovery chain. Point the env vars
or drop the binary into `~/.pi/agent/lsp/<language>/` to pick it up.

**Apex diagnostics never appear, even on obviously broken code:**
Apex jorje needs Java 11+. Confirm `JAVA_HOME` (or that `java` is on
`PATH`) and that the Apex LSP jar is discoverable via `SF_LSP_APEX_JAR`,
`.pi/lsp/apex/apex-jorje-lsp.jar`, the global dir, or your VS Code
Salesforce Apex extension.

**LWC diagnostics never appear:**
`lwc-language-server` must be discoverable (see the LWC chain). The
server also only runs against files inside an `lwc/` bundle; standalone
`.js` files are intentionally skipped.

**Diagnostics take >6 seconds to arrive:**
The request times out at 6s. Large first-time workspace scans can exceed
that on slow machines. Re-save the file to trigger a new request once
the server is warm.

**`.agent` files show no feedback or unexpected subprocess output:**
When `sf-agentscript-assist` is loaded, sf-lsp yields `.agent` files to
it entirely (faster, in-process). Check that extension's status with
`/sf-agentscript-assist doctor`. If `sf-agentscript-assist` is disabled,
sf-lsp falls back to the old subprocess path — set
`SF_LSP_AGENTSCRIPT_SERVER` or install the VS Code Agent Script extension
for discovery.

**Diagnostics keep firing against files I've closed:**
LRU eviction runs at 30 open files per server with a 60s idle cleanup
and 2-minute server idle shutdown. If you see stale diagnostics, wait
60s or run `/sf-lsp doctor` to restart discovery.

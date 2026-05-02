# SF LSP — Code Walkthrough

## What It Does

Provides real-time Language Server Protocol diagnostics to the agent after every
file write or edit, **and** a layered TUI so you can see exactly when the LSP
fired, what it returned, and how long it took.

When the agent creates or modifies an Apex class, LWC component, or Agent
Script file, sf-lsp sends it to the appropriate LSP server and appends
diagnostic feedback directly to the tool result. This means the agent sees
compile errors immediately — before moving on to the next task — and can
self-correct in the same turn.

The UI layer is pure presentation: **nothing extra is sent to the LLM** beyond
the existing `LSP feedback: …` text block. Every new surface reads from the
`details.sfPiDiagnostics` metadata that `lib/feedback.ts` already stamps onto
tool results. See [`ROADMAP.md`](./ROADMAP.md) for shipped phases and future
work.

**Why no in-card panel on the edit/write tool itself?** Pi refuses to load any
extension that re-registers a tool name already claimed by another extension
(see `detectExtensionConflicts` in `resource-loader`). Third-party extensions
like `pi-tool-display` already own the `edit`/`write` names for rendering
purposes, so sf-lsp stays out of that lane and communicates via the
transcript row, HUD, widget, and footer instead.

## TUI Surfaces

| Surface                | What it shows                                                                                    | Pi primitive                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Live working indicator | `⠋ LSP Apex…` spinner while diagnostics are being fetched (≤6s)                                  | `ctx.ui.setWorkingIndicator`                                                      |
| Footer status segment  | `LSP:●●● Apex·LWC·AS` with per-language health dots (picked up by `sf-devbar`)                   | `ctx.ui.setStatus` + `footerData.getExtensionStatuses()`                          |
| Below-editor widget    | `LSP · Foo.cls ok 312ms · Apex LWC AS` summary line                                              | `ctx.ui.setWidget` placement `belowEditor`                                        |
| Top-right HUD overlay  | Per-language rows: file, status, error count, duration, age                                      | `ctx.ui.custom` non-capturing overlay                                             |
| Inline transcript row  | `[sf-lsp] Apex · Foo.cls · clean · 312ms` — user-only, **never** reaches the LLM                 | `pi.sendMessage({customType:"sf-lsp", display:true})` + `registerMessageRenderer` |
| Rich `/sf-lsp` panel   | Doctor + recent activity ring + actions (refresh, HUD toggle, verbose toggle, shut down servers) | `ctx.ui.custom` overlay with `DynamicBorder` + `SelectList`                       |

**Agent Script note:** when the `sf-agentscript-assist` extension is loaded,
sf-lsp yields `.agent` files to it. That extension handles the same diagnostic
flow in-process via the vendored Agent Script SDK — faster, richer, and with
deterministic quick fixes. If `sf-agentscript-assist` is disabled, sf-lsp's
subprocess LSP path continues to handle `.agent` files exactly as before.

## How It Differs from VS Code

| VS Code                                   | sf-lsp (pi)                                           |
| ----------------------------------------- | ----------------------------------------------------- |
| Shows squiggly underlines in the editor   | Appends diagnostics to the agent's tool result        |
| Developer reads and fixes errors manually | **Agent reads and fixes errors automatically**        |
| Always shows all diagnostics              | Only shows errors (severity 1), ignores warnings      |
| Shows diagnostics for every open file     | Only diagnoses files the agent just wrote/edited      |
| No red/green transition tracking          | Tracks error → clean transitions per file per session |

## Supported Languages

| Language     | File Extensions                    | LSP Server                 |
| ------------ | ---------------------------------- | -------------------------- |
| Apex         | `.cls`, `.trigger`                 | Apex jorje (Java)          |
| LWC          | `.js`, `.html` (in `lwc/` bundles) | lwc-language-server (Node) |
| Agent Script | `.agent`                           | Agent Script LSP (Node)    |

## Runtime Flow

```
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
  ├─ Send file to LSP, wait ≤6s for diagnostics
  │
  └─ Decide what to append:
       Has errors? → "LSP feedback: MyClass.cls\n- L11: Expected ';'"
       Was error, now clean? → "LSP now clean: MyClass.cls"
       First time unavailable? → "LSP setup note: Apex LSP is unavailable..."
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
4. VS Code Agent Script extension (`agent-script-language-client-*`) —
   auto-detects both the v2.x layout (`dist/server.mjs`) and the v1.x layout
   (`server/server.js`)

Requires Node.js 18+.

### LWC

1. `SF_LSP_LWC_COMMAND` environment variable
2. `.pi/lsp/bin/lwc-language-server` (project-level)
3. `~/.pi/agent/lsp/bin/lwc-language-server` (global)
4. `lwc-language-server` on PATH

## Memory Management

Adopted from lsp-pi best practices:

- **LRU file eviction**: Max 30 open files per LSP server. When exceeded, the
  least-recently-accessed file is closed.
- **Idle file cleanup**: Files not accessed for 60s are automatically closed.
- **Idle server shutdown**: Servers with no activity for 2 minutes are shut down.
  They restart lazily when the next file is diagnosed.
- **Path normalization**: Uses `realpathSync` to handle macOS `/var` vs `/private/var`.

## Commands & Controls

| Command / shortcut                | Description                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `/sf-lsp`                         | Open the rich status & controls panel (doctor, recent activity, actions)                |
| `/sf-lsp doctor`                  | Compact doctor report via `ui.notify`                                                   |
| `/sf-lsp hud on\|off\|toggle`     | Show or hide the top-right HUD overlay (persisted to global settings)                   |
| `/sf-lsp verbose on\|off\|toggle` | Flip transcript rows between balanced (errors + transitions) and verbose (every check)  |
| `Ctrl+Shift+L`                    | Toggle the HUD overlay from anywhere                                                    |
| `pi --no-sf-lsp-hud`              | Launch with the HUD overlay suppressed. Widget, footer, and in-card panel still render. |

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

| Surface                   | Event/Trigger                                    | Result                                      |
| ------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Working indicator         | check started / finished                         | Push `⠋ LSP <Lang>…` / restore default      |
| Footer + widget + HUD     | any check                                        | Update activity store, re-render all three  |
| Transcript row (balanced) | error, error→clean transition, first unavailable | Emit one `sf-lsp` custom message            |
| Transcript row (verbose)  | every check                                      | Emit one `sf-lsp` custom message            |
| `/sf-lsp`                 | no args                                          | Open rich panel (doctor + recent + actions) |
| `/sf-lsp doctor`          | —                                                | `ui.notify` with availability report        |
| `Ctrl+Shift+L`            | —                                                | Toggle HUD overlay                          |
| `--no-sf-lsp-hud`         | startup                                          | HUD stays hidden for the session            |

## File Structure

```
extensions/sf-lsp/
  index.ts                ← entry point: events, commands, shortcuts, wiring
  manifest.json           ← metadata
  README.md               ← this file
  ROADMAP.md              ← shipped + planned phases
  lib/
    types.ts              ← LspDiagnostic, LspDoctorStatus, LspResult, SupportedLanguage
    file-classify.ts      ← file → language mapping, path resolution
    lsp-client.ts         ← LSP engine (discovery, spawn, diagnose, shutdown) — unchanged
    feedback.ts           ← red/green decision logic, rendering, LLM-facing contract — unchanged
    activity.ts           ← pure activity store (per-language entries, ring buffer, formatters)
    working-indicator.ts  ← ref-counted setWorkingIndicator helper
    footer-status.ts      ← theme-aware footer segment renderer
    below-editor.ts       ← theme-aware compact line renderer (placement:'belowEditor')
    hud-component.ts      ← top-right non-capturing HUD overlay component
    transcript.ts         ← custom message renderer + emit policy
    panel.ts              ← /sf-lsp rich overlay (DynamicBorder + SelectList)
    settings-io.ts        ← persistent sfPi.sfLsp { hud, verbose }
  tests/
    smoke.test.ts         ← module export check
    file-classify.test.ts ← file classification and path resolution
    feedback.test.ts      ← red/green logic and LLM text rendering
    activity.test.ts      ← pure activity store transitions
    transcript.test.ts    ← shouldEmitTranscriptRow policy
    footer-status.test.ts ← footer segment formatter with stub theme
```

## Testing Strategy

- **file-classify.ts**: Pure functions, fully tested with edge cases (backslashes,
  `@` prefix, case insensitivity, non-LWC `.js` files)
- **feedback.ts**: Pure decision logic and rendering, tested with factory helpers
  for diagnostics and state objects. Covers error, clean, unavailable, and
  transition scenarios.
- **lsp-client.ts**: Requires real LSP servers — tested via manual QA with
  `/sf-lsp doctor` and actual file edits against a connected org.

Run: `npm test`

## Troubleshooting

**`Failed to load extension ...sf-lsp/index.ts: Tool "edit" conflicts with ...`:**
Another extension (commonly `pi-tool-display`) already registers the
`edit` or `write` tool name. Pi's conflict detector refuses to load any
extension that re-registers those names. sf-lsp no longer tries to — if
you see this message on a current build, run `/reload` or update sf-pi.
The in-card panel is intentionally dropped; the transcript row + HUD +
footer now carry the same signal.

**HUD never appears even on wide terminals:**
The HUD is gated on `termWidth >= 100` and `termHeight >= 14` and on the
persisted `sfPi.sfLsp.hud` setting. Run `/sf-lsp hud on` to force it, use
`Ctrl+Shift+L` to toggle, or resize the terminal past the thresholds.
The `--no-sf-lsp-hud` CLI flag suppresses it for the session.

**Footer pill is empty or shows only dim dots:**
The activity store starts empty. The footer fills after the first real
check fires or after the background doctor probe on `session_start`
completes. If `sf-devbar` isn't loaded, the pill is still set — it's
just rendered by Pi's default footer instead of the dev bar.

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

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

| Surface                 | What it shows                                                                                                                                                                           | Pi primitive                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Working indicator       | `⠋ LSP Apex…` spinner while diagnostics are being fetched (≤6s)                                                                                                                         | `ctx.ui.setWorkingIndicator`                                                      |
| **Top-bar LSP segment** | Permanent right-aligned `LSP[Apex: ✓ \| LWC: ◐ \| AgentScript: ●]` inside sf-devbar. The `LSP[…]` wrapper disambiguates the dots from "feature enabled" indicators; glyph legend below. | `lib/common/sf-lsp-health` shared registry → sf-devbar top-bar widget             |
| Inline transcript row   | `[sf-lsp] Apex · Foo.cls · clean · 312ms` — user-only, **never** reaches the LLM                                                                                                        | `pi.sendMessage({customType:"sf-lsp", display:true})` + `registerMessageRenderer` |
| Rich `/sf-lsp` panel    | Doctor + recent activity ring + actions (refresh, verbose toggle, shut down servers)                                                                                                    | `ctx.ui.custom` overlay with `DynamicBorder` + `SelectList`                       |

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
| `/sf-lsp install`                 | Re-run the first-boot installer — detects + installs/updates bundled LSP servers       |
| `/sf-lsp install status`          | Show current install state per component (installed version vs. upstream latest)       |
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

## First-Boot Auto-Install

On `session_start`, sf-lsp runs a non-blocking check that compares the
Apex and LWC language servers on disk against the latest upstream
versions. If anything is missing or outdated and the user hasn't
already declined the current version, a single confirm dialog lists
everything that would be installed:

```
Install Salesforce LSP servers?

sf-pi wants to keep these Salesforce LSP servers current so Apex and
LWC diagnostics work out of the box. Downloads land under
  ~/.pi/agent/lsp/
(no sudo, no global npm, no PATH changes).

  • Apex Language Server — not installed, upstream 58.13.1 (~40 MB)
  • LWC Language Server — 4.10.0 → 4.12.3 (update available)

The install runs in the background. You can revisit this anytime with
  /sf-lsp install
```

### How it works

| Step      | Detail                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detect    | `fetchLatestApex()` queries the VS Marketplace Gallery API; `fetchLatestLwc()` queries the npm registry. Both are 5s abort-timed.                                                               |
| Compare   | Local versions come from `~/.pi/agent/lsp/apex/VERSION` and `~/.pi/agent/lsp/lwc/node_modules/@salesforce/lwc-language-server/package.json`.                                                    |
| Prompt    | One bundled `ctx.ui.confirm(...)` dialog. Skipped when everything is current or the user already declined the latest version.                                                                   |
| Install   | Apex → download vsix, unzip `extension/dist/apex-jorje-lsp.jar` → move into place + write `VERSION`. LWC → `npm install --prefix ~/.pi/agent/lsp/lwc @salesforce/lwc-language-server@<latest>`. |
| Indicate  | `ctx.ui.setWorkingIndicator('⠋ Installing Apex Language Server…')` while each component installs.                                                                                               |
| Summarize | Single `ctx.ui.notify(...)` with per-component ✓/✗ rows + any Java warning.                                                                                                                     |
| Re-probe  | `doctorLsp(...)` fires after completion so the sf-devbar top-bar LSP segment repaints green.                                                                                                    |

### Re-prompt behavior

Decline decisions persist to `~/.pi/agent/sf-lsp-install-state.json` as
`{ action: "decline", declinedVersion: "4.12.3" }`. On the next
`session_start`, if upstream publishes `4.12.4`, the orchestrator sees
that the declined version is now stale and re-prompts. This matches the
directive: tracking latest by default, never pinning, always offering
updates.

### Platform support

- **macOS / Linux / WSL**: full auto-install. Requires `unzip` and `npm`
  on PATH (both standard on developer machines).
- **Windows (native)**: the prompt is replaced with a notification that
  lists the exact manual steps for each missing component, and the
  decline is persisted so the user isn't nagged.
- **Java 11+**: detect-only. We never auto-install a JDK; when
  unavailable, the summary appends a `⚠ Java 11+: ...` line so the
  Apex diagnostics failure mode is obvious.

### Escape hatches

- `/sf-lsp install` — re-opens the confirm, resetting the per-session
  guard. Useful when the user dismissed the startup prompt.
- `/sf-lsp install status` — prints the per-component state without
  prompting or writing anything.
- Env vars (`SF_LSP_APEX_JAR`, `SF_LSP_LWC_COMMAND`, etc.) still win
  over the managed install — the orchestrator never touches user-owned
  LSP locations outside `~/.pi/agent/lsp/`.

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
easiest fix is `/sf-lsp install` — that drops the npm package into
`~/.pi/agent/lsp/lwc/` and sf-lsp picks it up on the next check. The
server also only runs against files inside an `lwc/` bundle; standalone
`.js` files are intentionally skipped.

**First-boot install prompt didn't appear:**
The orchestrator skips when (a) everything is already current, (b) the
user already declined the current upstream version, (c) the marketplace
/ npm-registry lookup failed (offline, corporate proxy), or (d) the
full discovery chain already resolved a working LSP from an external
source (VS Code Salesforce extensions, PATH, env override, or project
`.pi/lsp/`). In case (d) `/sf-lsp install status` will show the
component as `current` with a detail line like `Provided by VS Code
extension. Not managed by /sf-lsp install.` Run `/sf-lsp install` to
force the prompt anyway — it will still offer to install a managed
copy under `~/.pi/agent/lsp/` if you want sf-pi to own the version.

**Top-bar dots are green but the install prompt says "not installed":**
This was a bug in sf-pi < 0.27.6 where the orchestrator only checked
the managed `~/.pi/agent/lsp/` directory and ignored VS Code-provided
servers. Fixed in 0.27.6 by feeding the full doctor chain into the
detector. Upgrade and the prompt will respect externally-provided
servers.

**Install appears to hang:**
The Apex install downloads ~40 MB and `npm install` for LWC can take
30–60 s on first boot. The working indicator shows `Installing Apex
Language Server…` during this window. If it exceeds ~2 min, check
your proxy settings — both marketplace and registry respect standard
`HTTPS_PROXY` / `NO_PROXY` environment variables via Node's global
agent.

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

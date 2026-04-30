# SF Agent Script Assist — Code Walkthrough

## What It Does

Gives the agent in-process Agent Script feedback on every `.agent` file
write or edit — parse errors, compile errors, and deterministic quick
fixes, all without launching an LSP subprocess.

This extension replaces the `.agent` branch of `sf-lsp` with a faster,
more capable code path that uses the vendored
[`@agentscript/agentforce`](https://github.com/salesforce/agentscript)
SDK directly. Apex and LWC still flow through `sf-lsp`'s subprocess path
because they have no pure-TypeScript equivalent.

## Why In-Process Instead of LSP

| Concern         | Old subprocess LSP path                             | sf-agentscript-assist                       |
| --------------- | --------------------------------------------------- | ------------------------------------------- |
| Startup         | Spawn Node, JSON-RPC handshake, publish diagnostics | Single async import, then `compileSource()` |
| Missing signals | Only `publishDiagnostics`                           | Parse + lint + **compile** in one call      |
| Code actions    | Not consumed                                        | Rendered with exact TextEdit ranges         |
| Dialect info    | Not surfaced                                        | Surfaced on first feedback per file         |
| Dependencies    | VS Code extension or manually installed LSP binary  | Vendored dist committed to this repo        |

The SDK ships its Apache-2.0 licensed `browser.js` bundle — a single
self-contained ESM module — so we vendor exactly that file and load it at
runtime with `import()`.

## Runtime Flow

```
write/edit completes on a .agent file
  │
  ├─ sf-lsp checks: is sf-agentscript-assist loaded?
  │    yes → skip (we handle it here)
  │    no  → sf-lsp runs its old subprocess path (fallback)
  │
  ├─ Load vendored SDK (cached after first call)
  │
  ├─ Resolve dialect from `# @dialect:` or default to agentforce
  │
  ├─ Run sdk.compileSource(source)
  │    → parse diagnostics + lint diagnostics + compile diagnostics
  │
  ├─ Filter diagnostics to actionable set:
  │    severity 1 (Error)                    always
  │    severity 2 + code in allowlist        always
  │    everything else                       dropped
  │
  ├─ Build deterministic quick fixes:
  │    invalid-modifier, unknown-type        → typo replacement
  │    unknown-dialect                       → each candidate dialect
  │    deprecated-field                      → `data.replacement`
  │    unused-variable                       → delete `data.removalRange`
  │    invalid-version                       → each suggested version
  │
  └─ Decide what to append to the tool result:
       Has findings? → `LSP feedback:` block with diagnostics + fixes
       Was broken, now clean? → `LSP now clean:` note
       First time SDK unavailable? → `LSP setup note:`
       Clean, never broken? → silent
```

## Actionable Severity Filter

We never show severity 3 (Information) or 4 (Hint) — the noise-to-signal
ratio is too low for an agent loop. For severity 2 (Warning), we include
only codes where the SDK ships a deterministic fix the agent can apply:

- `deprecated-field`
- `unused-variable`
- `invalid-version`
- `unknown-dialect`
- `invalid-modifier`
- `unknown-type`

## Quick Fix Examples

```
LSP feedback: billing.agent
(Agent Script dialect: agentforce 2.5)
- L14: Field 'topic' is deprecated. Use 'subagent'.
    fix: Replace with 'subagent'  L14:0-5 → "subagent"
- L22 [warning]: Variable 'case_id' is declared but never used.
    fix: Remove unused variable  L21:0-L22:0 → "(delete)"
- L31: Unknown modifier 'mutabl' for variables x. Did you mean 'mutable'?
    fix: Change 'mutabl' to 'mutable'  L31:9-15 → "mutable"
```

Ranges are zero-based character offsets in LSP form (what the SDK
emits), rendered 1-based for the line number so humans and agents can
read them without mental conversion.

## Commands

| Command                               | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `/sf-agentscript-assist`              | Same as `doctor`                                      |
| `/sf-agentscript-assist doctor`       | Show SDK load status, vendored path, resolved dialect |
| `/sf-agentscript-assist check <file>` | Manually diagnose a single `.agent` file              |

We deliberately ship a minimal command surface. Most of the value flows
through the automatic `tool_result` hook. Commands exist only for the
two cases the hook can't cover: verifying the SDK is healthy, and
re-checking a file without writing to it.

## Coordination With sf-lsp

- **Both extensions installed (default)**: sf-agentscript-assist handles
  `.agent`. sf-lsp handles Apex + LWC only.
- **sf-agentscript-assist disabled**: sf-lsp falls back to the old
  subprocess LSP path for `.agent`. No configuration needed.
- **sf-lsp disabled**: sf-agentscript-assist still handles `.agent`.
  Apex and LWC feedback simply stops.

The precedence check is a single lookup against `pi.getCommands()` in
sf-lsp — no hardcoded extension IDs, no shared state, no ordering
assumptions.

## File Structure

```
extensions/sf-agentscript-assist/
  index.ts                ← entry: tool_result hook + /sf-agentscript-assist
  manifest.json           ← metadata (catalog source of truth)
  README.md               ← this file
  lib/
    types.ts              ← local types we surface (AgentScriptDiagnostic, …)
    sdk.ts                ← lazy import + cache of vendored SDK
    file-classify.ts      ← .agent detection and tool path resolution
    diagnostics.ts        ← parse + compile + actionability filter
    code-actions.ts       ← deterministic quick fix builders
    feedback.ts           ← red/green rendering + session state
    doctor.ts             ← /sf-agentscript-assist doctor probe + render
    vendor/
      agentforce/         ← vendored @agentscript/agentforce dist
        browser.js          single-file ESM bundle (no runtime deps)
        browser.js.map      source map
        index.d.ts          bundled TypeScript declarations
        UPSTREAM.md         commit SHA, version, Apache-2.0 attribution
  tests/
    smoke.test.ts
    file-classify.test.ts
    code-actions.test.ts
    feedback.test.ts
    diagnostics.test.ts
```

## Vendoring

The `@agentscript/agentforce` SDK is Apache-2.0 licensed but not
published to npm (it uses pnpm workspaces internally). We vendor the
built `browser.js` bundle into `lib/vendor/agentforce/` so `npm install`
works out of the box with no network, pnpm, or postinstall steps.

To refresh the vendored bundle:

```bash
node scripts/sync-agentforce-sdk.mjs              # pin to UPSTREAM_SHA in the script
node scripts/sync-agentforce-sdk.mjs --ref <sha>  # override pin
node scripts/sync-agentforce-sdk.mjs --check      # CI check: no writes
```

The script clones upstream at the pinned commit, runs the parser-javascript
build, copies `dist/browser.js`, `dist/browser.js.map`, and
`dist/index.d.ts` into `lib/vendor/agentforce/`, and rewrites
`UPSTREAM.md`. It does not touch anything else in the repo.

A weekly GitHub Action runs the same script and opens a PR when
upstream drifts. See `.github/workflows/sync-agentforce-sdk.yml`.

## Testing Strategy

- **file-classify.test.ts**: pure predicate for `.agent` detection +
  path resolution.
- **code-actions.test.ts**: quick fix generation for each supported
  diagnostic code, using synthetic diagnostic objects.
- **feedback.test.ts**: red/green session state + render layout using
  synthetic check results.
- **diagnostics.test.ts**: end-to-end integration against the vendored
  SDK with known-good + known-broken `.agent` sources.
- **smoke.test.ts**: module export contract.

Run: `npm test`

## Troubleshooting

**`LSP setup note:` shows up once on a `.agent` file:**
The vendored SDK failed to load on first use. Usually means the bundle
under `lib/vendor/agentforce/` is missing or corrupted. Verify with
`/sf-agentscript-assist doctor` — it reports SDK load status and the
vendored path. Re-sync the bundle with
`node scripts/sync-agentforce-sdk.mjs`.

**Agent Script diagnostics are silent even when the file is clearly broken:**
sf-agentscript-assist handles `.agent` only when loaded. Disable it and
sf-lsp's subprocess path takes over. Run `/sf-agentscript-assist doctor`
to confirm the extension is loaded and which dialect resolved. If dialect
detection missed the `# @dialect:` line, the check still runs against the
default `agentforce` dialect.

**Warnings show up but no quick fix is offered:**
Quick fixes are deterministic and only generated for a specific allow-list
of diagnostic codes (`deprecated-field`, `unused-variable`,
`invalid-version`, `unknown-dialect`, `invalid-modifier`, `unknown-type`).
Other warnings are reported without a fix by design — hallucinated fixes
are worse than none.

**Severity 3 / 4 diagnostics (info / hint) aren't showing:**
By design. The actionability filter drops Information and Hint severities
because the signal-to-noise ratio is too low in an agent loop. Severity 2
(Warning) is included only for codes in the allow-list above.

**Refreshing the vendored SDK without a full dev setup:**
`node scripts/sync-agentforce-sdk.mjs` clones upstream at the pinned SHA,
rebuilds `dist/browser.js`, and copies it in. `--check` is a CI-friendly
dry run. A weekly GitHub Action already opens a PR when upstream drifts.

**Quick-fix ranges look off by one:**
Ranges are zero-based character offsets (LSP form) for columns and
one-based for line numbers by design — that matches what humans and
agents actually read. If the fix applies cleanly but looks off in a log,
it's cosmetic.

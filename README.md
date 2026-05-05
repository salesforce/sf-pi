# sf-pi

[![CI](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/salesforce/sf-pi?sort=semver)](https://github.com/salesforce/sf-pi/releases)
[![CodeQL](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/salesforce/sf-pi/branch/main/graph/badge.svg)](https://codecov.io/gh/salesforce/sf-pi)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE.txt)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Last commit](https://img.shields.io/github/last-commit/salesforce/sf-pi)](https://github.com/salesforce/sf-pi/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

## What is this?

`sf-pi` is a bundle of opinionated extensions for the
[pi coding agent](https://pi.dev) aimed at developers who work on
Salesforce and Salesforce-adjacent codebases. It ships Apex/LWC LSP
diagnostics, an in-process Agent Script authoring companion, a Slack
research tool, a Salesforce-aware status bar, a splash screen, and a
central manager for enabling or disabling any of them per project or
globally.

![sf-pi updated screenshot 1](https://github.com/user-attachments/assets/cbf2db6b-939c-4c66-8dab-fc505749fc77)

![sf-pi updated screenshot 2](https://github.com/user-attachments/assets/8ee81b93-e336-4726-ba57-013ccbb5b0bf)

## Who built it

sf-pi is hosted at [github.com/salesforce/sf-pi](https://github.com/salesforce/sf-pi)
and maintained by
[Jag Valaiyapathy (@Jaganpro)](https://github.com/Jaganpro) —
a Senior Forward Deployed Engineer at Salesforce and Salesforce Certified
Technical Architect. It builds on
[Mario Zechner's](https://github.com/mariozechner) [pi coding agent](https://pi.dev)
and draws inspiration from the growing ecosystem of community pi
extensions — see [Credits](#credits) at the bottom of this README.

## Getting started

sf-pi runs inside pi. If you're brand new, install the runtime first,
then add sf-pi.

### Step 1 — Install Node.js

pi needs **Node.js `>=20`** (tested on 20 and 22).

- **macOS (recommended):** `brew install node`
- **Linux / WSL:** use your distro's package manager, or
  [`nvm`](https://github.com/nvm-sh/nvm) for version management
- **Windows:** installer from [nodejs.org](https://nodejs.org/), then
  use WSL for the best experience

Verify:

```bash
node --version    # v20.x or v22.x
npm --version
```

### Step 2 — Install the pi coding agent

```bash
npm install -g @mariozechner/pi-coding-agent
```

Then run `pi` in any folder to launch the TUI. Full docs, tutorials, and
extension authoring guides live at **[pi.dev](https://pi.dev)**.

> **New to pi?** Spend five minutes with the
> [pi.dev overview](https://pi.dev) before adding sf-pi. The `pi install`,
> `pi settings`, and `/reload` commands referenced below are all
> pi-native.

### Step 3 — Install sf-pi

```bash
# Install globally (visible in every pi session on your machine)
pi install git:github.com/salesforce/sf-pi

# Or install for a specific project (only active in that folder)
pi install -l git:github.com/salesforce/sf-pi
```

Restart pi or run `/reload`. Every extension ships enabled by default
— see the **Default** column in the [Bundled Extensions](#bundled-extensions)
table for exact per-extension defaults.

### Step 4 — Set up the terminal font (one-time)

The splash and status bars use
[Nerd Font](https://www.nerdfonts.com/) glyphs. If you see `?` or
plain-ASCII fallbacks, run:

```text
/sf-setup-fonts
```

Then set your terminal font to **MesloLGM Nerd Font Mono** and reopen
the terminal.

### Step 5 — (Recommended) install the community extension bundle

sf-pi expects a handful of community pi extensions (web search, tool
display, etc.) to be present for the best experience. Install the
curated bundle once:

```text
/sf-pi recommended install bundle:default
```

See [Recommended Extensions](#recommended-extensions) for per-package
details and why each one is worth it.

### Supported platforms

macOS, Linux, and WSL are the primary targets. Native Windows is
best-effort; WSL is recommended. The minimum pi version tracks the
`peerDependencies` range in [`package.json`](./package.json) (currently
`>=0.73.0`). Older pi runtimes are not supported; the shims in
[`lib/common/pi-compat.ts`](./lib/common/pi-compat.ts) fail gracefully with
a one-line "run `pi update`" warning instead of letting extensions crash on
missing runtime APIs.

## Announcements

The startup splash can show a small **Announcements** panel for sf-pi
maintainer notes and update nudges. Announcements come from the bundled
[`catalog/announcements.json`](./catalog/announcements.json), optionally merge
with a hosted JSON feed, and fail silently when offline.

Useful commands and controls:

```text
/sf-pi announcements                  # list active announcements
/sf-pi announcements dismiss <id>     # hide one item
/sf-pi announcements reset            # clear local dismissals
SF_PI_ANNOUNCEMENTS=off pi            # disable the feature for one run
SF_PI_ANNOUNCEMENTS_FEED=off pi       # keep bundled notes, skip remote feed
```

Persistent opt-out can also live in Pi settings:

```json
{ "sfPi": { "announcements": false } }
```

Or keep bundled/update notices while disabling only the hosted feed:

```json
{ "sfPi": { "announcements": { "feedEnabled": false } } }
```

## Command Reference

Every slash command lives inside a bundled extension. This table is the
fastest way to map a command to the extension that owns it. For subcommands
and flags, follow the link into each extension's README, or see the
auto-generated [`docs/commands.md`](./docs/commands.md) for a richer
per-extension view.

<!-- GENERATED:command-reference:start -->

Every slash command exposed by a bundled extension. See each extension README for subcommands and flags.

| Command                    | Extension                                                        | Category |
| -------------------------- | ---------------------------------------------------------------- | -------- |
| `/sf-agentscript-assist`   | [SF Agent Script Assist](./extensions/sf-agentscript-assist/)    | core     |
| `/sf-feedback`             | [SF Feedback](./extensions/sf-feedback/)                         | core     |
| `/sf-guardrail`            | [SF Guardrail](./extensions/sf-guardrail/)                       | core     |
| `/sf-lsp`                  | [SF LSP](./extensions/sf-lsp/)                                   | core     |
| `/sf-pi`                   | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-pi recommended`       | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-pi announcements`     | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-pi skills`            | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-slack`                | [SF Slack](./extensions/sf-slack/)                               | core     |
| `/sf-llm-gateway-internal` | [SF LLM Gateway Internal](./extensions/sf-llm-gateway-internal/) | provider |
| `/sf-devbar`               | [SF DevBar](./extensions/sf-devbar/)                             | ui       |
| `/sf-org`                  | [SF DevBar](./extensions/sf-devbar/)                             | ui       |
| `/sf-skills`               | [SF Skills HUD](./extensions/sf-skills-hud/)                     | ui       |
| `/sf-welcome`              | [SF Welcome](./extensions/sf-welcome/)                           | ui       |
| `/sf-setup-fonts`          | [SF Welcome](./extensions/sf-welcome/)                           | ui       |

<!-- GENERATED:command-reference:end -->

## Managing Extensions

Use the `/sf-pi` command to manage extensions interactively or via subcommands:

```text
/sf-pi                          # Open interactive TUI overlay
/sf-pi list                     # List extensions with status
/sf-pi enable <id>              # Enable an extension
/sf-pi disable <id>             # Disable an extension
/sf-pi enable-all               # Enable all extensions
/sf-pi disable-all              # Disable all (except manager)
/sf-pi status                   # Show summary
/sf-pi display                  # Show effective display profile
/sf-pi display compact          # Use terse summaries/minimal previews
/sf-pi display balanced         # Use concise defaults with useful previews
/sf-pi display verbose          # Use richer previews/full detail by default
/sf-pi recommended              # Open the recommended-extensions checklist
/sf-pi recommended list         # Print recommended extensions + your decisions
/sf-pi recommended install <id> # Install one recommended extension (or bundle:<name>)
/sf-pi recommended remove  <id> # Remove a recommended extension
/sf-pi recommended status       # Show revision + install/decline counts
/sf-pi skills                   # Wire Claude Code / Codex / Cursor skill dirs
/sf-pi skills list              # List detected external skill roots
/sf-pi skills link <path|label> # Add a root to settings.skills[]
/sf-pi skills unlink <path|label> # Remove a root from settings.skills[]
/sf-pi doctor                   # Diagnose startup, skill, and package setup
/sf-pi doctor fix startup       # Switch to quiet/header startup
/sf-pi doctor fix skills        # Quarantine duplicate sf-* skills and repair skill paths
/sf-pi help                     # Show available commands
```

Add `global` or `project` to target a specific settings scope:

```text
/sf-pi disable sf-ohana-spinner project
/sf-pi enable-all global
```

## Recommended Extensions

Beyond the extensions that ship inside this package, sf-pi maintains a
curated list of **recommended** open-source pi extensions. sf-pi does not
redistribute these packages — it points at their upstream sources, so
updates and credit flow through the original authors.

Install them all in one shot:

```text
/sf-pi recommended install bundle:default
```

Or cherry-pick individual packages with `/sf-pi recommended install <id>`.

### The default bundle

All eight packages are **MIT**-licensed and install per-user (global
scope) by default.

| Extension                                                             | Why install it                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`pi-skills`](https://github.com/badlogic/pi-skills)**              | Baseline skill library for pi. Unlocks search, Google Workspace, browser automation, YouTube transcripts, and more. Most other pi packages assume it's installed.                                     |
| **[`pi-web-access`](https://github.com/nicobailon/pi-web-access)**    | Web search, URL fetching, GitHub repo cloning, PDF extraction, YouTube + local video analysis. sf-pi itself expects the `web_search` and `fetch_content` tools this package provides.                 |
| **[`pi-aliases`](https://github.com/xRyul/pi-aliases)**               | Muscle-memory helpers like `/clear → /new` and `/exit → /quit`. Tiny, low-risk quality-of-life win — especially if you're coming from Claude Code or Codex CLI.                                       |
| **[`pi-interview`](https://github.com/nicobailon/pi-interview-tool)** | Gives pi a structured `interview` tool for multi-question requirement gathering and trade-off exploration. Pairs naturally with `sf-agentscript-assist` and other sf-pi scaffolding workflows.        |
| **[`glimpseui`](https://github.com/hazat/glimpse)**                   | Cross-platform micro-UI for scripts and agents — native WebView windows for rich visual explainers, charts, and HTML previews without launching a full browser. Used by the `visual-explainer` skill. |
| **[`pi-tool-display`](https://github.com/MasuRii/pi-tool-display)**   | Compact tool-call rendering, diff visualization, and output truncation. Significant quality-of-life boost for Salesforce workflows that inspect large metadata or log files.                          |
| **[`pi-updater`](https://github.com/tonze/pi-updater)**               | Keeps pi itself current without manual `pi update --self` calls. Low-friction way to stay on the latest runtime sf-pi targets.                                                                        |
| **[`pi-subagents`](https://github.com/nicobailon/pi-subagents)**      | Delegates work to single, chained, parallel, async, and forked-context subagents. Useful for advisory review, implementation handoffs, and larger planning flows.                                     |

Full manifest with source URLs, license info, and per-item `rationale`
strings: [`catalog/recommendations.json`](./catalog/recommendations.json).

### How the checklist works

- **Open it:** `/sf-pi recommended`
- **One-liner install:** `/sf-pi recommended install <id>`
- **Whole bundle:** `/sf-pi recommended install bundle:default`
- **Decline + forget:** pick `Never` in the checklist or `/sf-pi recommended remove <id>`

First-run behavior:

- On every `session_start`, sf-pi checks whether the manifest's `revision`
  differs from what you've already acknowledged. If it does, a one-line
  nudge appears in the footer status (`✨ sf-pi: N new recommended …`).
- Nothing installs automatically. You stay in control — run
  `/sf-pi recommended` when you're ready, pick what you want with Space,
  press Enter to apply.
- Decisions are sticky: items you installed or declined are never
  re-prompted across sessions.
- Opt out entirely with `SF_PI_RECOMMENDATIONS=off` in your environment.

Proposing a new recommendation: see
[CONTRIBUTING.md](./CONTRIBUTING.md#proposing-a-recommended-extension).

## Using Skills from Claude Code, Codex, or Cursor

Pi natively loads skills from `~/.pi/agent/skills/` and `~/.agents/skills/`.
Skill libraries from other harnesses — Claude Code (`~/.claude/skills`),
OpenAI Codex (`~/.codex/skills`), and Cursor (`~/.cursor/skills`) — require
a one-line settings edit to load in pi:

```json
// ~/.pi/agent/settings.json
{
  "skills": ["~/.claude/skills", "~/.codex/skills"]
}
```

`/sf-pi skills` does this for you. Run it and sf-pi:

1. Scans those three directories on disk, counts the skills it sees in each,
   and cross-references the list with your current `settings.skills[]`.
2. Opens a checklist — Space toggles a root, Enter applies.
3. Writes the delta back to `~/.pi/agent/settings.json` and reloads so the
   newly wired skills load immediately.

The splash also shows a single-line nudge under **Recommended** whenever it
detects an external root on disk that isn't yet in your settings:

```
• Interop  2 external skill roots (41 skills detected)
  → /sf-pi skills
```

Skills work side-by-side across harnesses — wiring a Claude Code directory
here does not copy, move, or touch the files in any way. Pi reads them in
place and Claude Code continues to use them unchanged.

## Bundled Extensions

<!-- GENERATED:bundled-extensions:start -->

For the canonical machine-readable bundle list, see [`catalog/index.json`](./catalog/index.json).

**Default** column: `on` = enabled on install, `opt-in` = disabled on install (enable with `/sf-pi enable <id>`), `always-on` = cannot be disabled.

| Extension                                                        | Category | Default   | Description                                                                                                                                                          |
| ---------------------------------------------------------------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SF Agent Script Assist](./extensions/sf-agentscript-assist/)    | core     | on        | In-process Agent Script authoring companion — parse, compile, and code-action feedback on every .agent write                                                         |
| [SF Brain](./extensions/sf-brain/)                               | core     | on        | High-density Salesforce operator kernel injected once per session — describe-before-query rules, API picker, anonymous Apex verification loop, and CLI power moves   |
| [SF Feedback](./extensions/sf-feedback/)                         | core     | on        | Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue                                                               |
| [SF Guardrail](./extensions/sf-guardrail/)                       | core     | on        | Salesforce-aware safety hooks — file protection policies, dangerous-command gating, and org-aware confirmation for production deploys, apex runs, and data mutations |
| [SF LSP](./extensions/sf-lsp/)                                   | core     | on        | Real-time Salesforce LSP diagnostics on write/edit with a working-indicator spinner, transcript rows, and a permanent top-bar health segment in sf-devbar            |
| [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     | always-on | Core manager — provides /sf-pi commands (always active)                                                                                                              |
| [SF Slack](./extensions/sf-slack/)                               | core     | on        | Slack integration — search messages, read threads, browse channel history                                                                                            |
| [SF LLM Gateway Internal](./extensions/sf-llm-gateway-internal/) | provider | on        | Salesforce LLM Gateway provider with model discovery                                                                                                                 |
| [SF DevBar](./extensions/sf-devbar/)                             | ui       | on        | Bespoke Salesforce developer status bar with org context, model info, git, and context window progress                                                               |
| [SF Ohana Spinner](./extensions/sf-ohana-spinner/)               | ui       | on        | Salesforce-themed rainbow spinner during LLM thinking                                                                                                                |
| [SF Skills HUD](./extensions/sf-skills-hud/)                     | ui       | on        | Pinned top-right overlay that shows which skills are live in context versus earlier in the session                                                                   |
| [SF Welcome](./extensions/sf-welcome/)                           | ui       | on        | Salesforce-branded splash screen with environment status, extension health, and community info                                                                       |

<!-- GENERATED:bundled-extensions:end -->

> **Note on `sf-llm-gateway-internal`:** this extension targets a
> Salesforce-internal gateway endpoint and is not usable by external
> developers. If you are not on the Salesforce corporate network, disable
> it with `/sf-pi disable sf-llm-gateway-internal` or supply your own
> OpenAI-compatible gateway via
> `SF_LLM_GATEWAY_INTERNAL_BASE_URL` + `SF_LLM_GATEWAY_INTERNAL_API_KEY`.

## SF LLM Gateway Internal Quick Start

The gateway extension requires you to set a base URL and API key. There is
no built-in default URL because the target endpoint is not publicly
reachable:

```bash
export SF_LLM_GATEWAY_INTERNAL_BASE_URL="https://your-gateway.example.com"
export SF_LLM_GATEWAY_INTERNAL_API_KEY="your-gateway-key"
```

Or configure directly inside pi with the built-in setup wizard:

```text
/sf-llm-gateway-internal setup              # Single overlay setup form
/sf-llm-gateway-internal on                 # Enable provider + set default model
/sf-llm-gateway-internal off                # Disable provider + restore previous default
/sf-llm-gateway-internal refresh            # Re-discover models + refresh budget
/sf-llm-gateway-internal set-default        # Set the scoped default model
/sf-llm-gateway-internal models             # List discovered gateway models
/sf-llm-gateway-internal debug <model>       # Inspect transformed upstream payload
/sf-llm-gateway-internal beta               # Show beta header state
/sf-llm-gateway-internal beta context-1m off # Toggle a beta header
```

### Session storage location

pi stores session transcripts in a default location (`~/.pi/agent/sessions`).
To relocate them — for example, onto a shared drive, an encrypted volume, or
a per-project folder — set `PI_CODING_AGENT_SESSION_DIR` in your environment
(pi ≥ 0.71.0). It is equivalent to passing `--session-dir` on every
invocation and is picked up by all sf-pi commands without any sf-pi change.

```bash
export PI_CODING_AGENT_SESSION_DIR="$HOME/.pi-sessions"
```

sf-pi requires pi `>=0.73.0`, so supported installations honor the env
var; older pi releases should be updated before running current sf-pi.

## Adding a New Extension

The fastest way is with scaffolding:

```bash
npm run scaffold -- --id sf-my-extension --category ui --name "My Extension"
```

This creates the full directory structure with boilerplate and regenerates the catalog.

Or manually:

1. Create `extensions/<id>/` with `index.ts` and `manifest.json`
2. Run `npm run generate-catalog` to regenerate the catalog
3. Run `npm run check` to verify types

See [AGENTS.md](./AGENTS.md) for contributor rules and
[ARCHITECTURE.md](./ARCHITECTURE.md) for the full repo guide, and
[CONTRIBUTING.md](./CONTRIBUTING.md) for the contributor workflow.

## Development

```bash
git clone https://github.com/salesforce/sf-pi.git
cd sf-pi
npm install

# Install locally for development
pi install .

# Scaffold a new extension
npm run scaffold -- --id sf-my-ext --category ui

# Regenerate catalog after editing manifest.json
npm run generate-catalog

# Format check
npm run format:check

# Type check
npm run check

# Run tests
npm test

# Full local validation (generate + docs health + SPDX + format + check + test)
npm run validate

# CI-like local validation, including ESLint and the LLM-artifact guard
npm run validate:ci

# Documentation drift helpers
npm run docs:health:check
npm run docs:changed
```

## How Enable/Disable Works

`sf-pi` uses pi's native
[package filtering](https://github.com/mariozechner/pi-coding-agent/blob/main/docs/packages.md#package-filtering)
in `settings.json`. When you disable an extension, the manager writes an
exclusion pattern (e.g., `!extensions/sf-ohana-spinner/index.ts`) to the
package entry and triggers a reload. Disabled extensions have zero runtime
cost — they are not loaded at all.

## Troubleshooting

Repo-wide tips first, then a per-extension index auto-generated from every
extension's `## Troubleshooting` section.

**Startup splash feels stuck or skill collisions keep appearing:**
Launch once with `SF_PI_SAFE_START=1 pi`, then run `/sf-pi doctor`. For the
common duplicate-skill case, `/sf-pi doctor fix skills` keeps the preferred
skill root active and moves duplicate `sf-*` skills from pi-owned roots into a
timestamped quarantine folder instead of deleting them. `/sf-pi doctor fix
startup` sets quiet/header startup so the full overlay no longer blocks input.

**`/sf-pi` commands say "package not found in settings":**
Run `pi install .` from the repo root, or `pi install git:github.com/salesforce/sf-pi`
to register the package in your pi settings.

**Tests fail locally but pass in CI:**
Delete `node_modules` and reinstall with `npm ci`.

**Generated docs say they're out of date (`npm run generate-catalog:check` fails):**
Run `npm run generate-catalog` and commit the refreshed `catalog/*`,
`docs/commands.md`, `docs/agent-orientation.md`, and the generated marker
blocks inside `README.md` / `ARCHITECTURE.md` / `extensions/*/README.md`.

### Per-extension index

<!-- GENERATED:troubleshooting-index:start -->

Jump to an extension's Troubleshooting section to see the full fix. This index is generated from the `## Troubleshooting` section in each extension README, so it never drifts.

**[SF Agent Script Assist](./extensions/sf-agentscript-assist/#troubleshooting)**

- `LSP setup note:` shows up once on a `.agent` file
- Agent Script diagnostics are silent even when the file is clearly broken
- Warnings show up but no quick fix is offered
- Severity 3 / 4 diagnostics (info / hint) aren't showing
- Refreshing the vendored SDK without a full dev setup
- Quick-fix ranges look off by one

**[SF Brain](./extensions/sf-brain/#troubleshooting)**

- Kernel never appears in the prompt
- User override does not take effect
- I want to see the kernel content in a session

**[SF Feedback](./extensions/sf-feedback/#troubleshooting)**

- `/sf-feedback` opens a browser URL instead of creating the issue
- Diagnostics show `unknown` or `unavailable`
- A private value appears in the preview

**[SF Guardrail](./extensions/sf-guardrail/#troubleshooting)**

- All production confirms are firing on my sandbox
- I cannot write to `destructiveChanges.xml` even though my rule is supposed to be off
- Headless CI fails with "Blocked by sf-guardrail in headless mode"
- `/sf-guardrail audit` is empty after /resume

**[SF LSP](./extensions/sf-lsp/#troubleshooting)**

- Top-bar LSP glyph legend
- The sf-devbar top-bar LSP segment stays `◌` (dotted circle) after a while
- Transcript rows feel too chatty / too quiet
- Working indicator keeps saying `LSP Apex…` after the turn ends
- `LSP setup note:` appears once per file type and then stays silent
- Apex diagnostics never appear, even on obviously broken code
- LWC diagnostics never appear
- First-boot install prompt didn't appear
- Top-bar dots are green but the install prompt says "not installed"
- Install appears to hang
- Diagnostics take >6 seconds to arrive
- `.agent` files show no feedback or unexpected subprocess output
- Diagnostics keep firing against files I've closed

**[SF Pi Manager](./extensions/sf-pi-manager/#troubleshooting)**

- `/sf-pi` says "package not found in settings"
- Disabling an extension through the manager doesn't take effect
- `/sf-pi enable-all` still leaves some extensions disabled
- Project-scoped changes aren't sticking
- Display profile change doesn't affect any output
- `/sf-pi recommended` shows no items or the opposite — too many
- `/sf-pi skills` says "No external skill directories detected"
- `/sf-pi skills` added a root but pi still doesn't load the skills

**[SF Slack](./extensions/sf-slack/#troubleshooting)**

- Footer shows `Slack: not configured` and no tools are available
- Footer shows `⚠ N requested scopes not granted`
- `slack_send` returns a `missing_scope` error mentioning four write scopes
- A Slack user or channel reference resolves to the wrong target
- `slack_canvas read` says "canvas not found"
- Search returns nothing from DMs or multi-party IMs
- `slack_send` refuses to run in `pi -p` / CI mode
- I need to see what `slack_send` posted (or attempted to post)

**[SF LLM Gateway Internal](./extensions/sf-llm-gateway-internal/#troubleshooting)**

- Startup warning `No models match pattern "sf-llm-gateway-internal/*"`
- Gateway fails on startup or tool calls error out immediately
- Claude responses appear to truncate and the agent asks you to type "continue"
- Opus 4.7 returns `api_error: Internal server error` on heavy turns
- gpt-5.5 fails with `Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. Please use /v1/responses instead.`
- Footer shows `⚠` badge after a 429 or 5xx
- I set `/thinking` to a different level but subsequent model switches reset it to `xhigh`
- Beta headers aren't taking effect
- Monthly-usage footer is stale or missing

**[SF DevBar](./extensions/sf-devbar/#troubleshooting)**

- Bars don't appear at all
- Org segment shows `…` or takes a long time
- Context bar starts empty and doesn't fill
- Gateway badge color is wrong when using sf-llm-gateway-internal
- `img:Nc` pill appears unexpectedly

**[SF Ohana Spinner](./extensions/sf-ohana-spinner/#troubleshooting)**

- Spinner colors look dim, washed-out, or garbled
- No spinner appears during LLM thinking

**[SF Skills HUD](./extensions/sf-skills-hud/#troubleshooting)**

- HUD never appears even though I know a skill was used
- A skill moved from Live to Earlier mid-session
- HUD doesn't update after switching branches with `/tree`
- I want the HUD off or a richer view

**[SF Welcome](./extensions/sf-welcome/#troubleshooting)**

- Splash shows `?` boxes (tofu) where glyphs should be
- Splash feels too busy, stuck, or setup warnings are noisy
- Splash content gets truncated in a narrow terminal
- What's New panel shows on first run or won't go away
- `/sf-setup-fonts` says everything is already installed but the splash still shows ASCII
- I was asked to install the font once and declined — how do I get the prompt back

<!-- GENERATED:troubleshooting-index:end -->

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Please also read our
[Code of Conduct](./CODE_OF_CONDUCT.md) and the
[Security Policy](./SECURITY.md) before contributing.

## Credits

- **[Mario Zechner (@mariozechner)](https://github.com/mariozechner)** —
  [pi coding agent](https://pi.dev) runtime that powers every extension
  in this repo.
- **[Armin Ronacher (@mitsuhiko)](https://github.com/mitsuhiko)** —
  Early inspiration from
  [agent-stuff](https://github.com/mitsuhiko/agent-stuff).
- **[Nico Bailon (@nicobailon)](https://github.com/nicobailon)** —
  [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer)
  inspired the visual design of `sf-devbar` (separator glyphs, color
  palette, pastel rainbow thinking badge). See
  [`extensions/sf-devbar/CREDITS.md`](./extensions/sf-devbar/CREDITS.md)
  for details.
- **[pi community](https://pi.dev)** — recommended-extension authors
  (see [Recommended Extensions](#recommended-extensions)) whose packages
  sf-pi leans on day-to-day.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).

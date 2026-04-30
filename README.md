# sf-pi

[![CI](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml)
[![CodeQL](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/salesforce/sf-pi/branch/main/graph/badge.svg)](https://codecov.io/gh/salesforce/sf-pi)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Last commit](https://img.shields.io/github/last-commit/salesforce/sf-pi)](https://github.com/salesforce/sf-pi/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

## What is this?

`sf-pi` is a bundle of opinionated extensions for the
[pi coding agent](https://github.com/mariozechner/pi-coding-agent) aimed at
developers who work on Salesforce and Salesforce-adjacent codebases. It
ships Apex/LWC LSP diagnostics, an in-process Agent Script authoring
companion, a Slack research tool, a Salesforce-aware status bar, a splash
screen, and a central manager for enabling or disabling any of them per
project or globally.

![sf-pi splash and TUI overlay](https://github.com/user-attachments/assets/3f5af05d-edfb-4c1f-854b-55fc227d5058)

## Requirements

- **Node.js** `>=20` (tested on 20 and 22)
- **[pi coding agent](https://github.com/mariozechner/pi-coding-agent)**
  — the minimum compatible version matches the `peerDependencies` range in
  [`package.json`](./package.json) (currently `>=0.70.3`). Older pi
  runtimes may work for individual extensions but are not tested; shims in
  [`lib/common/pi-compat.ts`](./lib/common/pi-compat.ts) soften some
  missing-method failures.
- macOS, Linux, or WSL. Native Windows is best-effort.

## Quick Start

```bash
# Install globally (visible in every pi session on your machine)
pi install git:github.com/salesforce/sf-pi

# Or install for a specific project (only active in that folder)
pi install -l git:github.com/salesforce/sf-pi
```

Then restart pi or run `/reload`. All extensions are enabled on install
by default. The **Default** column in the [Bundled Extensions](#bundled-extensions)
table below makes this explicit for every extension.

If the splash shows `?` or plain-ASCII fallback glyphs, install the bundled
Nerd Font once:

```text
/sf-setup-fonts
```

Set your terminal font to **MesloLGM Nerd Font Mono** and reopen the terminal.

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
| `/sf-lsp`                  | [SF LSP](./extensions/sf-lsp/)                                   | core     |
| `/sf-pi`                   | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-pi recommended`       | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
| `/sf-pi announcements`     | [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     |
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

- Full list: [`catalog/recommendations.json`](./catalog/recommendations.json)
- Open the checklist: `/sf-pi recommended`
- Install one item: `/sf-pi recommended install <id>`
- Install the default bundle: `/sf-pi recommended install bundle:default`

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

## Bundled Extensions

<!-- GENERATED:bundled-extensions:start -->

For the canonical machine-readable bundle list, see [`catalog/index.json`](./catalog/index.json).

**Default** column: `on` = enabled on install, `opt-in` = disabled on install (enable with `/sf-pi enable <id>`), `always-on` = cannot be disabled.

| Extension                                                        | Category | Default   | Description                                                                                                                                                        |
| ---------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SF Agent Script Assist](./extensions/sf-agentscript-assist/)    | core     | on        | In-process Agent Script authoring companion — parse, compile, and code-action feedback on every .agent write                                                       |
| [SF Brain](./extensions/sf-brain/)                               | core     | on        | High-density Salesforce operator kernel injected once per session — describe-before-query rules, API picker, anonymous Apex verification loop, and CLI power moves |
| [SF LSP](./extensions/sf-lsp/)                                   | core     | on        | Real-time Salesforce LSP diagnostics on write/edit — supports Apex, LWC, and Agent Script                                                                          |
| [SF Pi Manager](./extensions/sf-pi-manager/)                     | core     | always-on | Core manager — provides /sf-pi commands (always active)                                                                                                            |
| [SF Slack](./extensions/sf-slack/)                               | core     | on        | Slack integration — search messages, read threads, browse channel history                                                                                          |
| [SF LLM Gateway Internal](./extensions/sf-llm-gateway-internal/) | provider | on        | Salesforce LLM Gateway provider with model discovery                                                                                                               |
| [SF DevBar](./extensions/sf-devbar/)                             | ui       | on        | Bespoke Salesforce developer status bar with org context, model info, git, and context window progress                                                             |
| [SF Ohana Spinner](./extensions/sf-ohana-spinner/)               | ui       | on        | Salesforce-themed rainbow spinner during LLM thinking                                                                                                              |
| [SF Skills HUD](./extensions/sf-skills-hud/)                     | ui       | on        | Pinned top-right overlay that shows which skills are live in context versus earlier in the session                                                                 |
| [SF Welcome](./extensions/sf-welcome/)                           | ui       | on        | Salesforce-branded splash screen with environment status, extension health, and community info                                                                     |

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
/sf-llm-gateway-internal beta               # Show beta header state
/sf-llm-gateway-internal beta context-1m off # Toggle a beta header
```

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

# Full validation (generate + SPDX + format + check + test)
npm run validate
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

**`/sf-pi` commands say "package not found in settings":**
Run `pi install .` from the repo root, or `pi install git:github.com/salesforce/sf-pi`
to register the package in your pi settings.

**Tests fail locally but pass in CI:**
Delete `node_modules` and reinstall with `npm ci`.

**Generated docs say they're out of date (`npm run generate-catalog:check` fails):**
Run `npm run generate-catalog` and commit the refreshed `catalog/*`,
`docs/commands.md`, and the generated marker blocks inside
`README.md` / `ARCHITECTURE.md`.

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

**[SF LSP](./extensions/sf-lsp/#troubleshooting)**

- `LSP setup note:` appears once per file type and then stays silent
- Apex diagnostics never appear, even on obviously broken code
- LWC diagnostics never appear
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
- Footer shows `⚠` badge after a 429 or 5xx
- I set `/thinking` to a different level but subsequent model switches reset it to `xhigh`
- Beta headers aren't taking effect
- Monthly-usage footer is stale or missing

**[SF DevBar](./extensions/sf-devbar/#troubleshooting)**

- Bars don't appear at all
- Org segment shows `…` or takes a long time
- Context bar starts empty and doesn't fill
- CLI freshness check never updates
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
- Splash feels too busy or you want it out of the way
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

- **[Armin Ronacher (@mitsuhiko)](https://github.com/mitsuhiko)** — Early
  inspiration from
  [agent-stuff](https://github.com/mitsuhiko/agent-stuff).
- **[Mario Zechner (@mariozechner)](https://github.com/mariozechner)** —
  [pi coding agent](https://github.com/mariozechner/pi-coding-agent) runtime
  that powers every extension in this repo.

## License

Licensed under the [Apache License 2.0](./LICENSE).

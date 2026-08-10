---
title: Troubleshooting
description: Common SF Pi install, runtime, Salesforce, and extension recovery paths.
---

# Troubleshooting

Start with the symptom closest to what you see. For extension-specific fixes,
use the generated index on this page.

## SF Pi does not load

1. Restart pi or run `/reload`.
2. Confirm the package is installed in the expected scope:

   ```text
   /sf-pi status
   ```

3. Verify Node.js is at least `22.19`:

   ```bash
   node --version
   ```

4. Reinstall the package if pi cannot find it:

   ```bash
   pi install git:github.com/salesforce/sf-pi
   ```

## Salesforce commands cannot find an org

SF Pi uses Salesforce CLI authentication. Check the CLI directly:

```bash
sf org list --all
sf config get target-org
```

Authenticate or set the target org with the Salesforce CLI, then reload pi.

## Glyphs render as question marks

Run the font helper and switch your terminal to the installed Nerd Font:

```text
/sf-setup-fonts
```

## A bundled extension is noisy or not needed

Use the manager to disable optional extensions globally or for the current
project:

```text
/sf-pi
/sf-pi disable <extension-id>
/sf-pi enable <extension-id>
```

Always-on manager behavior is mediated by SF Pi Manager and cannot be disabled
from inside the package.

## Slack tools are unavailable

Slack tools register only after an auth token is available. Run:

```text
/sf-slack
```

Then follow the setup panel. If auth is missing, use `/login sf-slack` or your
approved automation token path.

## Data 360 or Agent Script calls fail

Confirm that the target Salesforce org is connected and has the required
features enabled. Start with the extension panels:

```text
/sf-data360
/sf-agentscript
```

For Data 360 readiness, use the read-only probe surface from `/sf-data360`.

## Extension troubleshooting index

<!-- GENERATED:extension-troubleshooting-index:start -->

Jump to an extension's Troubleshooting section to see the full fix. This index is generated from the `## Troubleshooting` section in each extension README, so it never drifts.

**[SF Pi Manager](./extensions/sf-pi-manager.md#troubleshooting)**

- `/sf-pi` says "package not found in settings"
- `pi --version` is newer than SF Pi's audited runtime range
- Disabling an extension through the manager doesn't take effect
- `/sf-pi enable-all` still leaves some extensions disabled
- Auto Update is on but Herdr was not updated
- Auto Update says it is waiting for `agent_settled`
- Project-scoped changes aren't sticking
- Display profile change doesn't affect any output
- `/sf-pi recommended` shows no items or the opposite — too many
- `/sf-pi skills` says "No external skill directories detected"
- `/sf-pi skills` added a root but pi still doesn't load the skills

**[SF LLM Gateway](./extensions/sf-llm-gateway.md#troubleshooting)**

- A discovered model shows its raw ID or conservative 128K/4K metadata
- Startup warning `No models match pattern "sf-llm-gateway/*"`
- Model discovery only returns `no-default-models`
- Login says the API key was saved but the model catalog could not be refreshed
- Gateway fails on startup or tool calls error out immediately
- A discovered model fails during a request
- Footer shows `⚠` badge after a 429 or 5xx
- I set `/thinking` to a different level but subsequent model switches reset it
- Monthly-usage footer is stale or missing
- Old and new gateway keys are confusing status or tests
- Doctor reports `WARN: fetch failed` on macOS even though `curl` works
- `/sf-llm-gateway onboard` says `not configured`

**[SF Apex](./extensions/sf-apex.md#troubleshooting)**

- `sf_apex` cannot resolve the org
- No log appears during `log.watch`
- Anonymous Apex is refused as mutating

**[SF Browser](./extensions/sf-browser.md#troubleshooting)**

- `agent-browser` is missing
- Chrome/Chromium cannot launch in a container or CI runner
- Snapshot refs fail
- Screenshots are too heavy
- A browser action is outside the hot path

**[SF Code Analyzer](./extensions/sf-code-analyzer.md#troubleshooting)**

- `code_analyzer doctor` says the plugin is missing
- PMD, CPD, or SFGE rules fail
- Flow Scanner rules fail
- A scan wrote files I did not expect

**[SF Data 360](./extensions/sf-data360.md#troubleshooting)**

- A simple DMO list returns too much data
- Metadata search fails but DMO/DLO lists work
- Connector detail returns `NOT_FOUND`
- `data360_*` tools are missing
- A mutating call is blocked in headless mode
- A versioned path is rejected

**[SF Docs](./extensions/sf-docs.md#troubleshooting)**

- SF Docs says it is not connected
- Collections look stale
- A fetch returned the wrong locale or version

**[SF Herdr](./extensions/sf-herdr.md#troubleshooting)**

- `sf_herdr_plan` is unavailable
- An ephemeral pane stayed open
- The Herdr package is missing

**[SF Slack](./extensions/sf-slack.md#troubleshooting)**

- No Slack footer pill appears and no tools are available
- Footer shows `✓ Connected · limited`
- Footer shows `· bot token` or `! Unsupported token`
- `slack_send action=dm` says `im:write` is missing
- A Slack user or channel reference resolves to the wrong target
- `slack_canvas read` says "canvas not found"
- `slack_canvas read` criteria returns invalid arguments
- `slack_canvas read` returns section IDs but no metadata
- Search returns nothing from DMs or multi-party IMs
- `slack_send` refuses to run in `pi -p` / CI mode
- I need to see what `slack_send` posted (or attempted to post)

**[SF tldraw](./extensions/sf-tldraw.md#troubleshooting)**

- The tool says no tldraw document is open
- Status reports a stale server configuration
- Status says the tldraw-offline Pi skill is missing, stale, or unmanaged
- A render says the document may have reached its page limit
- A render is blocked by readiness checks

**[SF Guardrail](./extensions/sf-guardrail.md#troubleshooting)**

- All production confirms are firing on my sandbox
- I cannot write to `destructiveChanges.xml` even though my rule is supposed to be off
- Headless CI fails with "Blocked by sf-guardrail in headless mode"
- `/sf-guardrail audit` is empty after /resume

**[SF Brain](./extensions/sf-brain.md#troubleshooting)**

- The constitution never appears in model context
- My user guidance does not take effect
- The Instruction Surface baseline is not comparable

**[SF Feedback](./extensions/sf-feedback.md#troubleshooting)**

- `/sf-feedback` opens a browser URL instead of creating the issue
- GitHub says the account cannot create issues
- Diagnostics show `unknown` or `unavailable`
- A private value appears in the preview

**[SF LSP](./extensions/sf-lsp.md#troubleshooting)**

- SF Welcome readiness glyph legend
- The SF Welcome LSP row stays unknown after startup
- Transcript rows feel too chatty / too quiet
- Working indicator keeps saying `LSP Apex…` after the turn ends
- `LSP setup note:` appears once per file type and then stays silent
- Apex diagnostics never appear, even on obviously broken code
- LWC diagnostics never appear
- First-boot install prompt didn't appear
- SF Welcome checks are green but the install prompt says "not installed"
- Install appears to hang
- Diagnostics take >6 seconds to arrive
- `.agent` files show no feedback or unexpected subprocess output
- Diagnostics keep firing against files I've closed

**[SF Data Explorer](./extensions/sf-data-explorer.md#troubleshooting)**

- `/sf-data-explorer` reports the transport could not be initialized
- Catalog never finishes loading
- Query refuses to run
- Exports are not where I expect

**[SF DevBar](./extensions/sf-devbar.md#troubleshooting)**

- Bars don't appear at all
- Org segment shows `…` or takes a long time
- Context bar is hidden or says `unknown`
- Gateway badge color is wrong when using sf-llm-gateway
- `img:Nc` pill appears unexpectedly

**[SF Ohana Spinner](./extensions/sf-ohana-spinner.md#troubleshooting)**

- Spinner colors look dim, washed-out, or garbled
- No spinner appears during LLM thinking

**[SF Skills](./extensions/sf-skills.md#troubleshooting)**

- My skills look duplicated — a wall of conflicts, and some show "Unknown source"
- Can I disable a globally-enabled skill for just one project
- A conflict shows REPORT-ONLY and `w` does nothing
- I added a custom path but it vanished after reload
- The funnel feels slow to open

**[SF Welcome](./extensions/sf-welcome.md#troubleshooting)**

- Splash shows `?` boxes (tofu) where glyphs should be
- The SF LSP row stays unknown after startup
- Herdr says the upstream package or Pi bridge is missing
- Splash feels too busy, stuck, or setup warnings are noisy
- Splash content gets truncated in a narrow terminal
- `/sf-setup-fonts` says everything is already installed but the splash still shows ASCII
- I was asked to install the font once and declined — how do I get the prompt back

<!-- GENERATED:extension-troubleshooting-index:end -->

## More troubleshooting links

- Command reference: [Commands](./commands.md)
- Extension inventory: [Bundled Extensions](./extensions.md)
- File an issue: [github.com/salesforce/sf-pi/issues](https://github.com/salesforce/sf-pi/issues)

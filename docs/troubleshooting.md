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

- The Manager cannot find SF Pi in settings
- A toggle does not take effect
- A newer stable Pi version is outside the audited window
- Auto Update skipped a package
- Auto Update waits for `agent_settled`
- Project changes do not stick
- Recommended items or skill roots look stale

**[SF LLM Gateway](./extensions/sf-llm-gateway.md#troubleshooting)**

- No models are available after installation
- Login saved the credential but refresh failed
- A discovered model shows conservative metadata
- Requests fail while `curl` works on macOS
- Usage or throttle status is stale
- Thinking changes after a model switch
- Saved and environment credentials conflict

**[SF Agent Script](./extensions/sf-agentscript.md#troubleshooting)**

- Agent Script SDK is unavailable
- Server compile rejects locally valid syntax
- A preview session is missing
- An eval appears stuck
- Live trace fetch returns no data
- Publish or activation fails on the agent user

**[SF Apex](./extensions/sf-apex.md#troubleshooting)**

- `sf_apex` cannot resolve the org
- No log appears during `log.watch`
- Anonymous Apex is refused as mutating

**[SF Browser](./extensions/sf-browser.md#troubleshooting)**

- `agent-browser` is missing
- Chrome cannot launch in a container
- A snapshot ref fails
- Screenshots are too heavy
- The action is outside the hot path

**[SF Code Analyzer](./extensions/sf-code-analyzer.md#troubleshooting)**

- The doctor says the plugin is missing
- PMD, CPD, or SFGE rules fail
- Flow Scanner rules fail
- A scan wrote unexpected files

**[SF Data 360](./extensions/sf-data360.md#troubleshooting)**

- A DMO list returns too much data
- Metadata search fails while DMO/DLO lists work
- A connector detail returns `NOT_FOUND`
- The family tools are missing
- A mutation is blocked headlessly
- A versioned path is rejected

**[SF Docs](./extensions/sf-docs.md#troubleshooting)**

- SF Docs is not connected
- Collections look stale
- Fetch returns the wrong locale or version

**[SF Herdr](./extensions/sf-herdr.md#troubleshooting)**

- `sf_herdr_plan` is unavailable
- An ephemeral pane stayed open
- The Herdr package is missing

**[SF LWC](./extensions/sf-lwc.md#troubleshooting)**

- No `sfdx-project.json` is found
- No components are found
- The local Jest runner is missing
- Jest fails without JSON
- Apex or schema validation is needed

**[SF Slack](./extensions/sf-slack.md#troubleshooting)**

- No Slack status or tools appear
- Status says connected but limited
- Status reports a bot or unsupported token
- Opening a DM says `im:write` is missing
- A fuzzy person/channel resolves incorrectly
- Canvas read cannot find content
- Scheduled delivery is absent from the Slack client Scheduled tab

**[SF SOQL](./extensions/sf-soql.md#troubleshooting)**

- A run returns a safety review
- Salesforce reports `INVALID_TYPE`
- Salesforce reports `INVALID_FIELD`
- No query plan is available
- The full result is absent from chat
- Export rejects a path

**[SF tldraw](./extensions/sf-tldraw.md#troubleshooting)**

- No tldraw document is open
- Runtime configuration is stale
- The app-owned skill is missing or stale
- A document reached its page limit
- Readiness blocks completion

**[SF Guardrail](./extensions/sf-guardrail.md#troubleshooting)**

- Production confirms fire for a sandbox
- A protected file remains blocked after removing an override
- Headless CI is blocked
- Audit is empty after resume

**[SF Brain](./extensions/sf-brain.md#troubleshooting)**

- The constitution never appears in model context
- User guidance does not take effect
- An Instruction Surface baseline is not comparable

**[SF Feedback](./extensions/sf-feedback.md#troubleshooting)**

- The flow opens a browser instead of creating an issue
- The account cannot create public issues
- Diagnostics contain `unknown` or `unavailable`
- A private value appears in preview

**[SF LSP](./extensions/sf-lsp.md#troubleshooting)**

- The Welcome row stays unknown
- Transcript rows are too chatty or quiet
- Setup guidance appears once and then stops
- Apex diagnostics never appear
- LWC diagnostics never appear
- The first-boot prompt did not appear
- Installation appears slow
- `.agent` diagnostics are absent

**[SF Data Explorer](./extensions/sf-data-explorer.md#troubleshooting)**

- The transport cannot be initialized
- Catalog loading does not finish
- A query is refused
- Exports are not where expected

**[SF DevBar](./extensions/sf-devbar.md#troubleshooting)**

- The bars do not appear
- The org segment stays pending
- Context says `unknown`
- The gateway badge color is unexpected
- An `img:Nc` pill appears

**[SF Ohana Spinner](./extensions/sf-ohana-spinner.md#troubleshooting)**

- Colors look dim or garbled
- No spinner appears

**[SF Skills](./extensions/sf-skills.md#troubleshooting)**

- Skills appear duplicated
- A project skill is locked
- A conflict is report-only
- A custom source vanished
- The funnel is slow to open

**[SF Welcome](./extensions/sf-welcome.md#troubleshooting)**

- Glyphs render as boxes
- The LSP row stays unknown
- Herdr reports missing tools
- Startup feels noisy
- Content is clipped
- Fonts are installed but glyphs remain wrong

<!-- GENERATED:extension-troubleshooting-index:end -->

## More troubleshooting links

- Command reference: [Commands](./commands.md)
- Extension inventory: [Bundled Extensions](./extensions.md)
- File an issue: [github.com/salesforce/sf-pi/issues](https://github.com/salesforce/sf-pi/issues)

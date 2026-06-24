# Bundled Extension Settings Surfaces

This page is the durable audit for SF Pi bundled-extension settings. It records
where each extension stores preferences, what the SF Pi Manager Settings page
edits, and whether a saved change needs a reload or only the next relevant
runtime event.

Use this page when adding a setting or when reviewing whether an extension still
has an older bespoke settings surface.

## Manager settings contract

Every bundled extension is listed in the SF Pi Manager. Each extension detail
page has a **Settings** drill-in page when `manifest.configurable === true`.
Settings pages should follow the contract from ADR 0055:

- edits stay in the settings page;
- unsaved changes are explicit;
- `S` or `Enter` saves when the page advertises save behavior;
- `Esc` / Back leaves the page and discards unsaved drafts;
- return `{ needsReload: true }` only when the saved value changes runtime
  registration, session-start state, or another value that cannot apply safely
  in the current page.

## Current audit

| Extension                 | Storage                                                                                                                                                     | Manager Settings edits                                                                                       | Save/apply behavior                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sf-agentscript`          | Pi settings: `sfPi.agentScript`                                                                                                                             | Preview mock mode, eval trace mode, eval concurrency defaults.                                               | Save in place. Explicit tool parameters still win; saved defaults apply to later Agent Script tool calls when the caller omits the matching parameter.                                |
| `sf-brain`                | Pi settings: `sfPi.brain` plus optional kernel override at `<globalAgentDir>/sf-brain/SF_KERNEL.md`.                                                        | Herdr workflow guidance add-on: `auto` or `off`.                                                             | Save in place. The core Salesforce Operator Kernel remains active while the extension is enabled; Herdr guidance changes apply when the extension context is next evaluated/injected. |
| `sf-browser`              | Pi settings: `sfPi.browser`; evidence artifacts under `<globalAgentDir>/sf-pi/browser-artifacts/**`.                                                        | Browser Evidence defaults: image mode, overlay dismissal, Setup Audit Trail inclusion.                       | Save in place. Explicit tool arguments win for a single capture; saved defaults apply to later evidence captures when omitted.                                                        |
| `sf-code-analyzer`        | Pi settings: `sfPi.codeAnalyzer`; reports under `<globalAgentDir>/sf-pi/code-analyzer/**`.                                                                  | Deferred auto-scan and ApexGuru auto-insight preferences.                                                    | Save in place. Explicit `code_analyzer` tool runs are unaffected; automation paths read the saved preferences.                                                                        |
| `sf-data-explorer`        | Pi settings: `sfPi.dataExplorer`; exports under `.sf-data-explorer/exports/`.                                                                               | Default explorer mode and default org for direct command usage.                                              | Save in place. Explicit `/sf-data-explorer <mode> [org]` arguments win.                                                                                                               |
| `sf-data360`              | Pi settings: `sfPi.data360`.                                                                                                                                | Default output mode for `data360_*` family tools.                                                            | Save in place. Explicit `output_mode` wins for a single call.                                                                                                                         |
| `sf-devbar`               | Pi settings: `sfPi.devbar.colors`.                                                                                                                          | DevBar color overrides.                                                                                      | Save in place. DevBar render paths refresh the cheap settings cache so changes apply without a reload.                                                                                |
| `sf-feedback`             | Pi settings: `sfPi.feedback`.                                                                                                                               | Default issue kind for feedback drafts.                                                                      | Save in place. Final preview and confirmation are always required before any issue submission.                                                                                        |
| `sf-guardrail`            | Pi settings: `sfPi.guardrail`; advanced rule overrides remain in the guardrail expert override file.                                                        | Routine Guardrail Preferences: confirmation timeout, protected org aliases, and per-rule behavior.           | Saves from the Manager Settings surface. Runtime safety decisions read effective settings dynamically; project-local weakening remains intentionally deferred.                        |
| `sf-herdr`                | Managed profile file: `<globalAgentDir>/sf-pi/herdr/preferences.json`.                                                                                      | Split direction, selected workflow/lane, and lane lifecycle.                                                 | Save in place. `sf_herdr_plan` reads the managed profile for later plans; proactive Herdr guidance is controlled by SF Brain settings.                                                |
| `sf-llm-gateway-internal` | Gateway saved config: `~/.pi/agent/sf-llm-gateway-internal.json` and `<project>/.pi/sf-llm-gateway-internal.json`; Pi model defaults/scopes in Pi settings. | Saved base URL, API key, scoped model mode; setup action page can save, enable, or disable gateway defaults. | Settings save in place and reports reload-required when saved config changes outside the setup action page. Setup/enable/disable actions perform the runtime orchestration directly.  |
| `sf-lsp`                  | Pi settings: `sfPi.sfLsp`.                                                                                                                                  | Verbose transcript row preference.                                                                           | Save in place. Direct `/sf-lsp verbose` updates the live session immediately; Manager Settings updates the persisted preference used by later session/startup reads.                  |
| `sf-ohana-spinner`        | Pi settings: `sfPi.ohanaSpinner.mode`.                                                                                                                      | Spinner mode: `ohana` or `calm`.                                                                             | Save in place and reports reload-required when changed because the working indicator is installed during `session_start`.                                                             |
| `sf-pi-manager`           | Pi settings: `sfPi.display.profile` plus package filter settings for extension lifecycle.                                                                   | Shared display profile: `compact`, `balanced`, or `verbose`.                                                 | Save in place; no reload required for display profile. Extension enable/disable lifecycle actions still reload.                                                                       |
| `sf-skills`               | Pi settings: `sfPi.skills`; skill wiring remains native `settings.skills[]`; Source Registry stores seen custom sources.                                    | Passive HUD visibility and default managed-skill install scope.                                              | Save in place. HUD visibility applies on the next HUD refresh; Skill Funnel and defaults actions remain separate action pages because they can edit `settings.skills[]` and reload.   |
| `sf-slack`                | Pi settings: `sfPi.slack`; credential in Pi auth store; legacy session preference entries are fallback only.                                                | Result detail, thread/history body detail, research widget, compact permalink preferences.                   | Save in place. Explicit tool parameters still win.                                                                                                                                    |
| `sf-welcome`              | Existing Pi startup setting: top-level `quietStartup`; state files under `~/.pi/agent/sf-welcome-state.json` and `<globalAgentDir>/sf-pi/sf-welcome/**`.    | Startup surface: `header` or `overlay`.                                                                      | Save in place. The saved value affects later startup; `--verbose` still forces the full overlay.                                                                                      |

## Storage conventions

Use these defaults for new settings:

1. Use Pi settings under `sfPi.<extensionKey>` for routine user preferences.
2. Keep secrets and credential-like values outside normal Pi settings. Use the
   extension's existing secure saved-config or Pi auth store path.
3. Use managed state files under `<globalAgentDir>/sf-pi/<namespace>/` for
   structured profiles or session-independent state that is not meant for manual
   editing.
4. Keep project-local settings from weakening safety posture without a dedicated
   trust-aware design and ADR.

## Deferred ideas

The migration intentionally kept the settings small. Candidate future settings
should be added only after a user-facing need is clear. Examples:

- more `sf-herdr` per-lane alias/label editors;
- richer `sf-browser` evidence viewport presets;
- additional `sf-agentscript` eval defaults;
- a reset-to-default affordance shared across settings panels.

---
title: "SF Browser"
description: "Salesforce-aware agent-browser affordance layer for UI last-mile work that Salesforce APIs cannot cover. It registers a cache-first /sf-browser panel plus a small hot-path browser tool set, curated Setup Destinations, Browser Evidence, and lazy agent-browser invocation after explicit command/tool intent."
---

# SF Browser

Salesforce-aware agent-browser affordance layer for UI last-mile work that Salesforce APIs cannot cover. It registers a cache-first /sf-browser panel plus a small hot-path browser tool set, curated Setup Destinations, Browser Evidence, and lazy agent-browser invocation after explicit command/tool intent.

## What it is

Salesforce-aware browser automation for last-mile UI work using agent-browser.

## At a glance

| Property         | Value                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-browser`                                                                                                       |
| Category         | Agent Tool                                                                                                         |
| Maturity         | experimental                                                                                                       |
| Default state    | on                                                                                                                 |
| Runtime surfaces | commands, tools, events                                                                                            |
| Source           | [`extensions/sf-browser/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-browser)                    |
| Full README      | [`extensions/sf-browser/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-browser`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-browser
/sf-pi disable sf-browser
/sf-pi status sf-browser
```

## Runtime surfaces

- **Commands:** `/sf-browser`
- **LLM tools:** `sf_browser_open_org`, `sf_browser_snapshot`, `sf_browser_click`, `sf_browser_fill`, `sf_browser_select`, `sf_browser_press`, `sf_browser_wait`, `sf_browser_capture_evidence`, `sf_browser_resolve_path`
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

## Agent tools

Agents can call these tools when the extension is enabled and configured:

- `sf_browser_open_org`
- `sf_browser_snapshot`
- `sf_browser_click`
- `sf_browser_fill`
- `sf_browser_select`
- `sf_browser_press`
- `sf_browser_wait`
- `sf_browser_capture_evidence`
- `sf_browser_resolve_path`

## Safety and privacy

- No startup probes; agent-browser is detected only from /sf-browser doctor or explicit tool/command actions.
- Browser Evidence is artifact-first and stored outside the project by default.
- Session-bearing Salesforce org-open URLs are passed to agent-browser but not echoed in tool results.

## Configuration and state

State files:

- `&lt;globalAgentDir&gt;/sf-pi/browser-artifacts/sessions/&lt;session-id&gt;/index.json`
- `&lt;globalAgentDir&gt;/sf-pi/browser-artifacts/sessions/&lt;session-id&gt;/*.png`
- `&lt;globalAgentDir&gt;/sf-pi/browser-artifacts/sessions/&lt;session-id&gt;/*.jpg`
- `&lt;globalAgentDir&gt;/sf-pi/browser-artifacts/latest/pointer.json`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/index.ts)
- [`lib/agent-browser.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/agent-browser.ts)
- [`lib/evidence-report.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/evidence-report.ts)
- [`lib/operations.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/operations.ts)
- [`lib/failure-diagnostics.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/failure-diagnostics.ts)
- [`lib/setup-destinations.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/setup-destinations.ts)
- [`lib/overlay-dismissal.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/overlay-dismissal.ts)
- [`lib/snapshot-summary.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/snapshot-summary.ts)
- [`lib/lightning-wait.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/lightning-wait.ts)
- [`lib/sf_browser_select-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/sf_browser_select-tool.ts)
- [`lib/sf_browser_resolve_path-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/sf_browser_resolve_path-tool.ts)
- [`lib/salesforce-path-resolver.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/lib/salesforce-path-resolver.ts)
- [`skills/sf-browser/SKILL.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/skills/sf-browser/SKILL.md)
- [`skills/sf-browser/references/setup-runbooks.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/skills/sf-browser/references/setup-runbooks.md)
- [`skills/sf-browser/references/setup-destinations.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/skills/sf-browser/references/setup-destinations.md)
- [`skills/sf-browser/references/live-smoke.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/skills/sf-browser/references/live-smoke.md)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-browser)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md#troubleshooting) for extension-specific recovery steps.

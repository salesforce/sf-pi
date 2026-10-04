---
title: "SF Browser"
description: "Salesforce-aware browser automation for last-mile UI work using agent-browser."
editLink: false
---

# SF Browser

<p class="sfpi-page-lead">Salesforce-aware browser automation for last-mile UI work using agent-browser.</p>

## What it does

Salesforce-aware agent-browser affordance layer for UI last-mile work that Salesforce APIs cannot cover. It registers a cache-first /sf-browser panel plus a small hot-path browser tool set, one discriminated navigation target and wait condition, in-process single-access org opening with same-org direct navigation and CLI fallback, local route planning with exact org verification only where required, fresh-ref enforcement, idempotent disclosure and toggle state changes, navigation-aware Setup/App Launcher summaries, curated Setup Destinations, recognized ambient-overlay dismissal, changed-only Browser Evidence, compact result cards, and lazy agent-browser invocation after explicit command/tool intent.

## Start

Open the extension from its primary command:

```text
/sf-browser
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-browser
/sf-pi enable sf-browser
/sf-pi disable sf-browser
```

## Safety notes

- No startup probes; agent-browser is detected only from /sf-browser doctor or explicit tool/command actions.
- Browser Evidence is artifact-first and stored outside the project by default.
- Snapshot overlay dismissal targets only recognized ambient Salesforce assistance surfaces and never clicks arbitrary Close controls.
- Known paths, home, Setup, Data Cloud, object-list, object-new, and record-view targets resolve locally; only targets requiring exact org lookup enter Salesforce route verification.
- Semantic Setup navigation uses bounded exact-label matching, optional category disambiguation, and observed-state postconditions; it never fuzzy-clicks or persists a runtime menu crawl.
- Same-org navigation reuses the authenticated Salesforce host; cold and cross-org navigation generates a single-use URL in-process through Salesforce singleaccess, with sf org open retained only as a bounded fallback.
- Org opening verifies the requested path and allows one direct-path correction while requiring the authenticated landing host to remain stable.
- Ref-based actions reject stale, expired, missing, or unpublished snapshot refs before invoking agent-browser, and conditional wait timeouts fail closed.
- Disclosure operations require an explicit desired state, resolve nested Setup Expand/Collapse controls, and verify a fresh observed state.
- Snapshots publish compact ref metadata so SF Guardrail can classify committing click refs from the latest accessible label.
- Toggle operations require an explicit desired state, capture before/after evidence, verify a fresh observed state, and never claim pending-save state is persisted.
- Session-bearing Salesforce org-open URLs are passed to agent-browser but not echoed in tool results.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-browser`
- **Intent:** Work with Salesforce orgs
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-browser`
- **LLM tools:** `sf_browser_open_org`, `sf_browser_navigate_setup`, `sf_browser_snapshot`, `sf_browser_click`, `sf_browser_fill`, `sf_browser_select`, `sf_browser_set_expanded`, `sf_browser_set_toggle`, `sf_browser_press`, `sf_browser_editor`, `sf_browser_wait`, `sf_browser_capture_evidence`, `sf_browser_resolve_path`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-browser)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/docs/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md#troubleshooting) for extension-specific recovery steps.

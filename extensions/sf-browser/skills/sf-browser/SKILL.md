---
name: sf-browser
description: Use when automating, inspecting, or capturing Salesforce UI with SF Browser or agent-browser. Trigger for Salesforce Setup UI, Lightning UI, builders, managed package configuration pages, UI-only checks, screenshots, and last-mile browser work that Salesforce APIs cannot cover.
---

# SF Browser

SF Browser is an experimental developer-assistive surface for Salesforce UI last-mile work. It does not imply a stable Salesforce UI automation contract.

Use Salesforce APIs first for setup and verification. Use SF Browser and agent-browser only for UI surfaces that are not reachable or trustworthy through APIs.

For repeatable CI regression testing, route users to purpose-built UI testing tooling such as page-object or locator-based frameworks. SF Browser is for last-mile UI work, Browser Evidence, and UI fallback paths; it is not the source of truth for durable automated test suites.

## Core loop

1. Open the org/path with `sf_browser_open_org`. Prefer a curated `setup` destination or structured `route` when the target is known (for example `setup: "agentforce-agents"` or `route: { type: "record-view", objectApiName: "Account", recordId: "001..." }`) instead of search-and-click navigation. Use `sf_browser_resolve_path` first when you want to preview or disambiguate navigation.
2. After open/deep-link navigation, prefer `sf_browser_wait` with `lightning: "navigation-ready"`, then run `sf_browser_snapshot` before acting. Snapshot is pi-native by default: `outputMode: "summary"` returns compact decision-oriented context with page URL, surface, tabs, record actions, field edit actions, related lists, object-list controls, quick-action forms, alerts, table/list summaries, and a full raw snapshot artifact.
3. Use refs from the latest snapshot with `sf_browser_click`, `sf_browser_fill`, `sf_browser_select`, or `sf_browser_press`. For code-like editor surfaces where normal fill is insufficient, use `sf_browser_editor` with `action: "detect"`, then read or write by `editorIndex`.
4. After page-changing actions, run `sf_browser_wait` (`navigation-ready` for navigation, `app-ready` for in-page rerenders, `save-result` after saves), then `sf_browser_snapshot` again.
5. Capture Browser Evidence with `sf_browser_capture_evidence` when visual confirmation matters.

Refs are short-lived. Treat them as stale after clicks, saves, modal opens, navigation, tab switches, or Lightning rerenders. If a browser action fails, use the returned failure kind, recovery hint, diagnostic snapshot, and diagnostic screenshot before retrying. If the summary misses needed controls, retry with `focus` terms or explicitly request `outputMode: "full"`.

## Salesforce UI patterns

- Prefer snapshot refs over CSS selectors. Salesforce generated ids and internal classes are not stable.
- For lookup and combobox controls: fill the visible input, wait for options, snapshot, then click the desired option ref.
- For code-like editor surfaces, use `sf_browser_editor` instead of generic DOM eval when it can detect the editor. It supports `detect`, bounded `read`, and full-content `write`; writes do not click Save/Apply and do not echo full content.
- For Setup navigation, prefer curated Setup Destinations over UI search when available. Use structured routes for common Lightning pages: `home`, `setup`, `object-list`, `object-new`, `record-view`, `list-view`, and `record-related-list`.
- For Data Cloud navigation, use the `data-cloud` route (`{ "type": "data-cloud", "destination": "<id>" }`). It resolves a verified Destination Pack covering the Data Cloud Settings menu; see `references/data-cloud-destinations.md`. Only `verified` entries are navigable. The Data Cloud app container URL is org-specific, so open the app via the App Launcher and reach its tabs by snapshot + click. Packs are grown and re-verified out-of-band by the dev-time Navigation Hardening Harness (`npm run e2e:sf-browser-harden`), which also verifies the curated Setup Destinations and structured routes (`--surface all|data-cloud|setup-destinations|routes`), never by runtime menu scraping. If fuzzy Setup Destination resolution returns multiple candidates, ask the user to choose instead of guessing. `sf_browser_open_org` verifies structured routes through Salesforce APIs before opening; raw `path` remains the direct escape hatch. `object-new` only opens Salesforce's deterministic new-record URL; org overrides or record-type flows may render differently, so verify with a Lightning wait and snapshot instead of assuming a modal opened. Use `lightning: "navigation-ready"` after deep links; DOMContentLoaded alone is often not enough.
- For Classic Setup Surface dual-list controls, use `sf_browser_select` on the source listbox, click Add or Remove, snapshot before Save, then verify through API after Save.
- For save flows, wait for visible confirmation such as a toast, success text, or expected page state, then snapshot again. Treat near-timeout waits as ambiguous and verify before continuing.
- If expected controls are missing, consider iframe/frame surfaces or use direct `agent-browser` commands as the escape hatch. `agent-browser frame @iframeRef` scopes snapshot/click-style commands, but frame-scoped `eval` is not guaranteed; do not rely on raw eval for iframe-local Visualforce form submission or dialog handling.
- If a Classic Setup save/submit causes repeated agent-browser command timeouts or empty snapshots, treat the browser runtime as wedged: verify state through Salesforce APIs when possible, restart/reopen the browser session from the Salesforce org alias, and only then retry.
- Browser Evidence is session-scoped. Use `imageMode: "artifact"` for repeated screenshots or batches; use `thumbnail` when the model should inspect the current screen; thumbnail mode defaults the screenshot viewport to 1440x1000 so the image is not a cramped half-height capture. Use `full` only when visual fidelity matters and the image is small enough. Use `scrollToRef` when evidence needs a lower-page section in view. For UI Mutation Fallbacks, capture before/after evidence with clear labels and use `includeSetupAuditTrail: true` on the after-capture when recent Setup Audit Trail context is useful.
- Keep `dismissOverlays` enabled for Browser Evidence unless the overlay is part of the task. It is best-effort and only targets known non-workflow Salesforce overlays.

## Setup Runbooks

For common setup/admin tasks, use the reference runbooks before improvising UI automation:

- Use `/sf-browser evidence [limit]` to list current-session Browser Evidence captures, artifact paths, and Setup Audit Trail enrichment status without returning image bytes.
- `references/setup-runbooks.md` — API-first/browser-ready workflows and UI fallback paths.
- `references/setup-destinations.md` — curated Setup Destination shortcuts. Runtime destination metadata includes suggested waits and default snapshot focus terms.
- `references/live-smoke.md` — read-only live smoke checklist for route resolution, Lightning waits, snapshots, and session-scoped evidence.

A Setup Runbook should prefer the primary API or owning SF Pi extension first, use SF Browser for evidence, and fall back to UI automation only when the primary path fails or is unavailable.

## Long-tail escape hatch

SF Browser only wraps the hot path: open, snapshot, click, fill, select, press, editor detect/read/write, wait, and Browser Evidence capture.

For scroll, hover, drag, upload, tabs, state, console, network, eval, trace, video, HAR, or advanced CDP work, use direct `agent-browser` commands. Start with:

```bash
agent-browser skills get core
```

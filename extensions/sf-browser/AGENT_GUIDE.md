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

Read **one** child. Do not load the whole `docs/` folder.

- Salesforce UI patterns (lookups, Setup, Data Cloud, Classic dual-list, evidence) → [`docs/ui-patterns.md`](./docs/ui-patterns.md)
- setup runbooks → [`docs/setup-runbooks.md`](./docs/setup-runbooks.md)
- destinations / live smoke → [`docs/setup-destinations.md`](./docs/setup-destinations.md) · [`docs/data-cloud-destinations.md`](./docs/data-cloud-destinations.md) · [`docs/live-smoke.md`](./docs/live-smoke.md)

Use `/sf-browser evidence [limit]` to list current-session Browser Evidence without returning image bytes. A Setup Runbook should prefer the primary API or owning SF Pi extension first, use SF Browser for evidence, and fall back to UI automation only when the primary path fails or is unavailable.

## Long-tail escape hatch

SF Browser only wraps the hot path: open, snapshot, click, fill, select, press, editor detect/read/write, wait, and Browser Evidence capture.

For scroll, hover, drag, upload, tabs, state, console, network, eval, trace, video, HAR, or advanced CDP work, use direct `agent-browser` commands. Start with:

```bash
agent-browser skills get core
```

## Related domain skills

Prefer `sf_browser_*` for Salesforce UI last-mile work. If it cannot cover the work, read the vendor skill `agent-browser` from vercel-labs/agent-browser.

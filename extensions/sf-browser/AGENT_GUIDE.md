# SF Browser

SF Browser is an experimental developer-assistive surface for Salesforce UI last-mile work. It does not imply a stable Salesforce UI automation contract.

Use Salesforce APIs first for setup and verification. Use SF Browser and agent-browser only for UI surfaces that are not reachable or trustworthy through APIs.

For repeatable CI regression testing, route users to purpose-built UI testing tooling such as page-object or locator-based frameworks. SF Browser is for last-mile UI work, Browser Evidence, and UI fallback paths; it is not the source of truth for durable automated test suites.

## Core loop

1. Open the org with `sf_browser_open_org` and one discriminated `target` (for example `{ type: "setup", destination: "agentforce-agents" }`, `{ type: "external-client-app", appName: "ExampleEca" }`, or `{ type: "record-view", objectApiName: "Account", recordId: "001..." }`). Explicit paths, home, curated Setup/Data Cloud destinations, object list/new, and record view resolve locally. External Client App, list-view, and related-list targets use Salesforce APIs because exact org resolution is required. After authentication, SF Browser verifies the requested path; on mismatch it reopens the explicit target-org frontdoor once, then allows one direct-path correction while requiring the authenticated landing host to remain stable. Use `sf_browser_resolve_path` with the same `target` first when you want to preview or disambiguate navigation.
2. After open/deep-link navigation, prefer `sf_browser_wait` with `condition: { type: "lightning", value: "navigation-ready" }`, then run `sf_browser_snapshot` before acting. When the effective `dismissOverlays` setting is enabled (default), snapshots close only recognized ambient overlays such as My Service Journey and security-contact notices before publishing refs. Snapshot is pi-native by default: `outputMode: "summary"` returns compact decision-oriented context with page URL, surface, tabs, record actions, field edit actions, related lists, object-list controls, quick-action forms, alerts, table/list summaries, and a full raw snapshot artifact.
3. Use refs from the latest snapshot with `sf_browser_click`, `sf_browser_fill`, or `sf_browser_select`; those tools reject refs from stale, expired, missing, or different snapshots before invoking agent-browser. Use `sf_browser_press` for the currently focused control. For code-like editor surfaces where normal fill is insufficient, use `sf_browser_editor` with `action: "detect"`, then read or write by `editorIndex`.
4. After page-changing actions, run `sf_browser_wait` with one condition (`navigation-ready` for navigation, `app-ready` for in-page rerenders, `save-result` after saves), then `sf_browser_snapshot` again. Conditional timeouts fail closed; an ambiguous `save-result` remains a classification that requires snapshot or API verification.
5. Capture Browser Evidence with `sf_browser_capture_evidence` when visual confirmation matters.

Refs are short-lived. Treat them as stale after clicks, saves, modal opens, navigation, tab switches, or Lightning rerenders. If a browser action fails, use the returned failure kind, recovery hint, diagnostic snapshot, and diagnostic screenshot before retrying. If the summary misses needed controls, retry with `focus` terms or explicitly request `outputMode: "full"`.

Read **one** child. Do not load the whole `docs/` folder.

- Salesforce UI patterns (lookups, Setup, Data Cloud, Classic dual-list, evidence) → [`docs/ui-patterns.md`](./docs/ui-patterns.md)
- setup runbooks → [`docs/setup-runbooks.md`](./docs/setup-runbooks.md)
- destinations / live smoke → [`docs/setup-destinations.md`](./docs/setup-destinations.md) · [`docs/data-cloud-destinations.md`](./docs/data-cloud-destinations.md) · [`docs/live-smoke.md`](./docs/live-smoke.md)

Use `/sf-browser evidence [limit]` to list current-session Browser Evidence without returning image bytes. A Setup Runbook should prefer the primary API or owning SF Pi extension first, use SF Browser for evidence, and fall back to UI automation only when the primary path fails or is unavailable.

## Long-tail escape hatch

SF Browser only wraps the hot path: open, snapshot, click, fill, select, press, editor detect/read/write, wait, and Browser Evidence capture.

Do not replace supported `sf_browser_*` actions with direct `agent-browser` shell commands. Recover through the typed tool diagnostics or report the blocker; direct commands remain separately Guardrail-mediated and are only for capabilities outside the hot path.

For scroll, hover, drag, upload, tabs, state, console, network, eval, trace, video, HAR, or advanced CDP work, use direct `agent-browser` commands. Start with:

```bash
agent-browser skills get core
```

## Related domain skills

Prefer `sf_browser_*` for Salesforce UI last-mile work. If it cannot cover the work, read the vendor skill `agent-browser` from vercel-labs/agent-browser.

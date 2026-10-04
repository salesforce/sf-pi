---
id: "0011"
status: accepted
date: 2026-05-20
---

# ADR 0011: SF Browser uses agent-browser as a lazy hot-path runtime

SF Browser is an experimental developer-assistive Bundled Extension for Salesforce UI last-mile work that Salesforce APIs cannot cover; it does not imply a stable Salesforce UI automation contract. We decided to use `agent-browser` as a Lazy Browser Runtime and expose only a cache-first `/sf-browser` command panel plus a Hot-Path Browser Tool Set (`open`, `snapshot`, `click`, `fill`, `press`, `wait`, and Browser Evidence capture), rather than wrapping the full browser automation surface or building a Playwright/Selenium-style driver layer. This keeps SF Pi agent-first, avoids boot-time probes and permission fatigue, preserves `agent-browser`'s fast CDP workflow, and leaves advanced browser work to direct `agent-browser` usage.

## Consequences

- SF Browser does not pursue feature parity with `agent-browser`.
- SF Browser does not mediate normal browser actions with v1 permission gates.
- `agent-browser` is detected and invoked only after explicit command or tool intent.
- Browser Evidence stores full-resolution screenshots privately under a per-session `browser-artifacts/sessions/<session-id>/` directory, tracks captures with a lightweight index, and returns bounded image content only through explicit evidence capture modes. The legacy `browser-artifacts/latest/` location is only a pointer to the current session's evidence directory.
- Salesforce Browser Contracts live in tool descriptions, tool results, help, and optional progressive skills rather than complex runtime logic.
- SF Browser v1 uses one default named `agent-browser` session instead of per-org or per-conversation browser sessions.
- Click and fill tools are ref-first in v1; semantic locator hardening remains a future decision, with direct `agent-browser` usage as the escape hatch.

## Follow-up learnings from first org test

The first Agentforce setup check showed that SF Browser needs more Salesforce-specific first-shot behavior while keeping the runtime thin:

- Browser Evidence should perform best-effort Ambient Overlay Dismissal for known non-workflow Salesforce overlays so screenshots are not obscured by guidance, security, or contact panels.
- SF Browser should prefer curated Setup Destinations, such as `agentforce-agents`, over search-and-click navigation when the target Setup path is known.
- These refinements remain contracts and small helpers, not a broad DOM abstraction or full Setup sitemap.
- Snapshot results should be pi-native: full `agent-browser` output is saved as an artifact, while the default model-visible content is a smart, icon-labeled summary with page URL, surface classification, alerts, primary actions, table/list summaries, and focus matches. Full inline snapshot output remains explicit opt-in.
- SF Browser tool results should include user-visible elapsed duration to make optimized last-mile workflows measurable without treating the value as an SLA or benchmark.
- SF Browser owns setup/admin UI evidence and fallback runbook references so SF Pi can stay API-first while remaining browser-ready when APIs or owning extensions fail.
- Salesforce Classic Setup Surface runbooks should use `select` plus Add/Remove controls for dual-list pages, treat near-timeout waits as ambiguous, and recover from validation errors through evidence capture plus direct navigation.
- Browser Evidence should support explicit scroll targeting (`scrollToRef`) so lower-page assertions can produce useful screenshots without adding automatic visual search.

## Follow-up decisions from Salesforce automation reliability review

A later review of Salesforce Lightning automation patterns refined SF Browser's reliability direction while preserving the ADR's original boundary: SF Browser remains a composable Salesforce-aware affordance layer over `agent-browser`, not a Playwright replacement, workflow DSL, or UI testing framework. Repeatable CI regression testing should use purpose-built UI testing tooling such as page-object or locator-based frameworks; SF Browser should stay focused on agent-driven last-mile work, evidence, and UI fallback paths.

- Browser Evidence should be session-scoped. Canonical evidence artifacts live under a per-pi-session directory, while the legacy `latest` location may remain as a compatibility pointer to the current session. Screenshots should not be duplicated between locations.
- Mutation transparency should be evidence-based, not approval-based. UI-only Salesforce setup/configuration changes remain frictionless; agents capture before/after Browser Evidence with clear labels, and may request best-effort Setup Audit Trail context on evidence capture.
- SF Browser should not add a compound `sf_browser_step` / workflow tool. The product favors explicit, composable primitives even when that costs extra tool calls or tokens.
- SF Browser should add a deterministic Salesforce Path Resolver for one discriminated navigation target (`path`, `home`, curated setup destination, Data Cloud destination, object list, object new, record view, or an exact-org route). Bounded fuzzy matching is allowed only within curated Setup Destinations; ambiguous matches should ask the user to choose instead of guessing.
- Path resolution should not perform live schema/data verification by default. Explicit paths, home, Setup, Data Cloud, object-list, object-new, and record-view targets construct known Lightning URL shapes with local validation. External Client App, list-view, and related-list targets are explicit exceptions because their exact org paths require Tooling or UI API lookup.
- `sf_browser_wait` should expose one discriminated wait condition and Lightning-Aware modes for app readiness, record view, modal open/closed, toast, spinner completion, and save result. These waits use browser-side JavaScript heuristics through `agent-browser wait --fn`, return structured matched/ambiguous/timed-out status, and fail closed when a conditional wait reaches the timeout window.
- `save-result` is an outcome classifier, not a success assertion. It should distinguish success toast, error toast, validation error, record view, modal closed, classic error, and ambiguous outcomes.
- Smart Snapshot Summary should include structured Lightning state derived from the current URL and raw accessibility snapshot, without issuing extra browser JavaScript calls in the first implementation.
- Ref-first click, fill, and select tools should enforce the latest session-scoped snapshot state before invoking agent-browser. Stale, expired, missing, or unpublished refs fail fast and are never automatically remapped to a guessed element.
- Org opening should verify the requested path before reporting success. On mismatch, one bounded reopen of the explicit target-org frontdoor is allowed, followed by one direct-path correction that must remain on the authenticated landing host. The live Navigation Hardening Harness uses an isolated browser session and asserts the observed path so concurrent interactive sessions cannot produce false-green destination evidence; Salesforce instance, My Domain, Setup, and Lightning hostnames are not compared as org identity because one org can legitimately use different hostnames.
- Annotated screenshots and video recording are deferred until session-scoped evidence, path resolution, Lightning-aware waits, and Lightning state summaries have landed.

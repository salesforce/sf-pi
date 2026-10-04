---
id: "0135"
status: accepted
date: 2026-10-04
---

# ADR 0135: SF Browser uses bounded semantic navigation for Salesforce Setup chrome

SF Browser will expose Salesforce Setup and App Launcher navigation as closed-loop, desired-state operations rather than relying only on raw click refs. Curated Setup Destinations and verified Destination Packs remain the preferred deterministic path. A bounded exact-label Setup fallback covers long-tail categories and child items without introducing a runtime sitemap or persistent menu crawl.

## Context

Salesforce Setup navigation represents one category with several accessibility nodes: a tree item that publishes `expanded`, a nested Expand or Collapse button, a category link, and child links. A generic click can successfully dispatch against the tree item without proving that the category changed state. Compact snapshots also historically filtered global controls such as App Launcher and the top-right Setup menu and retained only the selected Setup tree item, removing the hierarchy needed to choose the correct control.

ADR 0030 rejected a full runtime menu crawler and arbitrary fuzzy Setup search. That boundary remains useful: org capabilities, licenses, and seasonal navigation labels vary, and an unbounded runtime sitemap would be slow and brittle. The missing capability is not broad crawling; it is bounded semantic interaction with one exact requested category, item, or global menu entry.

## Decision

- Compact snapshots include bounded global-navigation context and preserve the Setup relationship between category, expansion control, category link, and visible child links.
- `sf_browser_set_expanded` accepts an explicit desired state, maps a Setup tree item to its nested Expand or Collapse control, and verifies the result in a fresh snapshot. It also supports expandable global controls such as App Launcher and the top-right Setup menu.
- `sf_browser_navigate_setup` opens Setup Home in the explicit target org and performs bounded exact-label navigation for one category, child item, or top-right Setup entry. Optional category context disambiguates duplicate item labels. The tool returns `not-found`, `ambiguous`, or `postcondition-failed` instead of fuzzy-clicking.
- Runtime Setup navigation does not enumerate or persist a complete org menu. Curated destinations and verified packs remain the source for stable direct paths.
- Lightning apps gain a verified structured route resolved by AppDefinition developer name and org-specific DurableId. App Launcher remains available for interactive browsing.
- The Navigation Hardening Harness adds a read-only chrome-navigation surface that proves category expand/collapse, exact child navigation, App Launcher desired state, and a verified Lightning-app route against an explicit non-production org.

## Consequences

- Agents can navigate long-tail Setup areas without guessing generated selectors or confusing a tree item with its nested expansion button.
- A dispatched click is no longer success evidence for semantic Setup navigation; fresh observed state or a verified destination is required.
- The runtime tool surface grows by two narrow Salesforce-specific controls rather than a generic workflow DSL.
- Live hardening remains opt-in, explicit-org, read-only, and artifact-first. Org-specific screenshots and paths are not committed.

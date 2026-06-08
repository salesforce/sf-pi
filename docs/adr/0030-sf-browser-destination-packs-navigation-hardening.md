# ADR 0030: SF Browser comprehensive navigation via verified Destination Packs and a dev-time hardening harness

To let SF Browser natively navigate broad product areas such as Data Cloud (settings menu, app tabs, and builder pages) without turning the intentionally small curated Setup Destination list into a sitemap, we decided to add a separate, typed, live-verified **Destination Pack** addressed by a new structured route, and to grow and maintain packs through a dev-time **Navigation Hardening Harness** rather than runtime menu scraping. The runtime agent reads only verified pack entries; discovery, verification, screenshots, and candidate proposals happen out-of-band against an explicitly targeted org.

## Status

accepted

## Context

- The `CONTEXT.md` glossary defines a **Setup Destination** as intentionally small and explicitly rejects a "full Setup sitemap", a "live menu scraper", and "arbitrary natural-language setup search". The **Salesforce Path Resolver** carries the same anti-goals.
- A request to "natively navigate all parts of the Data Cloud settings menu, the app, and all tabs and pages, and recursively harden" reads as a comprehensive sitemap, which directly tensions with those documented anti-goals, and leans into Data Cloud territory that **SF Data 360** owns under the **D360 Domain Boundary**.
- Data Cloud navigation spans three distinct URL families: `/lightning/setup/...` admin nodes, Lightning app tabs (usually object list views), and record/builder deep links. Treating them as one untyped path list is a known source of brittleness.

## Decision

- Keep the hand-curated `setup-destinations.ts` list small and public-safe. Add a **Destination Pack** as a separate, generated and live-verified registry for one product area (Data Cloud first).
- Type every pack entry by **Navigation Surface** (`setup-node` | `app-tab` | `builder-page`) so a single `resolve → open → wait → snapshot` workflow carries the real per-surface differences in URL shape, expected Lightning surface, and verification.
- Address packs at runtime through one new structured route, `{ type: "data-cloud", destination: "<id>" }`, on the existing navigation tool — no new runtime tool, no parallel resolver.
- Grow and maintain packs with a dev-time **Navigation Hardening Harness**: a re-runnable script that opens each entry against an explicit org, applies the suggested Lightning-Aware Wait, captures one Browser Evidence screenshot per entry, asserts the expected surface, optionally crawls the area to emit candidate entries for human review, and marks changed or unreachable entries broken. It never auto-commits discovered entries into the runtime pack.
- The runtime agent reads only `verified` entries. Candidates and broken entries are review state, not navigation state.
- Mutation needs no new primitives. The pack must reach mutable surfaces, and the harness exercises one representative safe mutation lifecycle (navigate → open create/edit → fill → evidence → cancel/cleanup) against a disposable test org to prove the path end-to-end, mirroring the existing Family Lifecycle Scenario pattern.

## Considered Options

- **Expand the curated Setup Destination list with all Data Cloud entries.** Rejected: directly violates the documented "intentionally small / not a sitemap" anti-goal and mixes verified-by-hand shortcuts with bulk navigation data.
- **Runtime live menu crawl with per-session caching.** Rejected: this is the "live menu scraper" anti-goal — slow, non-deterministic, and brittle on every turn.
- **Push Data Cloud navigation into SF Data 360.** Rejected: SF Data 360 is API-first and owns Data Cloud _API_ workflows; UI navigation, evidence, and UI mutation fallback are SF Browser's domain.
- **Auto-commit discovered entries straight into the runtime pack.** Rejected: unreviewed entries risk navigation drift and public-safety leakage of org-specific paths.

## Consequences

- SF Browser gains comprehensive Data Cloud navigation while the curated list stays small; "comprehensive for an area" lives in packs, not in `setup-destinations.ts`.
- The runtime path stays deterministic and fast and contains no scraping; correctness is maintained out-of-band by re-running the harness, which catches Salesforce navigation drift.
- The harness is dev-time only: not a runtime tool, not in the manifest tool set, not in the boot path, and not in the default test run. It follows the existing `scripts/e2e/*.ts` + `npm run e2e:*` precedent and is invoked with an explicit target org.
- Screenshots are captured through the existing session-scoped Browser Evidence pipeline and surfaced via a generated dev contact-sheet report; they are not committed to the repo by default to avoid org-data leakage and churn.
- The pack registry is the source of truth; its human-facing reference Markdown is generated and drift-tested like other generated references.
- The pattern generalizes: a second product area can become another pack, and the route can later widen to a generic `{ type: "pack", pack, destination }` shape if a second pack appears. We ship the concrete Data Cloud route first.

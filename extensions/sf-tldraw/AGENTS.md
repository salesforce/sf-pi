# sf-tldraw editing rules

Start from `index.ts`, the relevant implementation module below, and its focused Behavior Proof. Use [`docs/README.md`](./docs/README.md) only for task-specific reference depth.

## File map

| Responsibility                                           | File                                     |
| -------------------------------------------------------- | ---------------------------------------- |
| Pi registration and Manager-first command                | `index.ts`                               |
| Single family tool and action schema                     | `lib/tldraw_canvas-tool.ts`              |
| Loopback API, bearer-token handling, capability boundary | `lib/runtime-client.ts`                  |
| Shared explicit runtime/document presentation            | `lib/runtime-surface.ts`                 |
| Strict Salesforce Diagram Spec v2 schema                 | `lib/spec-schema.ts`                     |
| Grounding, provenance, privacy, and semantic refinements | `lib/spec-validation.ts`                 |
| SLDS icons, marker assets, product-mark gate             | `lib/assets.ts`                          |
| Dagre/fixed-lane placement                               | `lib/layout.ts`                          |
| Family-to-canvas compilation                             | `lib/profiles.ts`                        |
| Fixed tldraw editor program and readiness checks         | `lib/canvas-program.ts`                  |
| Render orchestration and evidence                        | `lib/renderer.ts`, `lib/artifacts.ts`    |
| Five inherited preferences                               | `lib/settings.ts`, `lib/config-panel.ts` |

## Invariants

- Keep one tool: `tldraw_canvas`. Its public actions are status, documents, create_document, cheatsheet, and the three Salesforce render families; generic canvas work belongs to the upstream skill.
- Never probe the runtime during module load or `session_start`. The session hook reads only the small server-config presence signal; live readiness is explicit and on demand.
- Require the tldraw offline v1.12 contract. Until upstream exposes machine-readable capabilities, prove it only from required markers in the app-owned `/readme`.
- Treat the app as the sole owner of the `tldraw-offline` Pi skill. Read its managed marker/manifest for status, but never package, copy, extract, or rewrite the skill.
- `create_document` accepts only a plain name, uses tldraw's default Documents directory, and never runs implicitly from a render action.
- Advertise and accept only strict Salesforce Diagram Spec v2 through the three family schemas.
- Reject unknown fields, product marks, source positions, endpoint anchors, and layout mode.
- Never guess Salesforce facts. Every semantic element cites a declared source id; artifact evidence is provenance, not an independent fact-verification claim.
- Enforce render privacy on every user-visible string and never persist execution-only `target_org`.
- Never expose the tldraw bearer token, raw auth headers, or private org execution identifiers.
- Use `helpers.createArrowBetweenShapes` for meaningful connectors.
- Sequence activation intervals must be explicit, evidenced spec elements; never infer processing duration from adjacent messages.
- Cross-lane message labels require measured borderless backings and verified z-order above intersecting lifelines or activation bars.
- Cardinality placement must use clipped `getArrowInfo()` terminals and verify the local marker anchor through `getShapePageTransform(marker).applyToPoint(...)`.
- Data Model relationships render no endpoint or field-name text. Lookup connectors are black medium dotted; master-detail connectors are red medium solid; cardinality stays on the endpoint markers.
- Data Model canvases render only title header text plus the separately managed stacked Relationships key when **Legend — Relationships** is `show`; scope and grounding remain artifact-only. Hide never moves preserved cards, while new/replace/relayout uses the compact title-only top margin.
- Recursive data-model relationships require an exterior route with distinct card ports; never accept a centre-bound self arrow.
- A successful render requires zero actionable tldraw lints, marker distance at most one canvas unit, and no overlapping marker bounds.
- Verify that requested page creation succeeded before rendering; never fall through to whichever page was already active.
- Preserve user positioning and annotations by default. Only shapes carrying `meta.sfTldraw.managed === true` belong to this extension.
- Never add AppleScript, keystrokes, browser automation, or direct `.tldraw` archive generation as a create-document fallback.
- Keep `docs/cheatsheet.md` lazy. Do not register it as a skill or inject it into every prompt.
- Keep SLDS assets unchanged and update `CREDITS.md` when asset provenance changes.

## Non-goals

- Generic drawing DSL or MCP server.
- Salesforce org querying or docs retrieval; existing SF Pi capability owners gather evidence and pass a normalized spec.
- Mermaid replacement when the user explicitly requests Mermaid or text.
- Silent page splitting, shrink-to-fit, autoplay, or deletion of user annotations.

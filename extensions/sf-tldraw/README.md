# SF tldraw

## What It Does

SF tldraw connects Pi to the local tldraw offline Canvas API and renders editable
Salesforce diagrams from explicit, evidence-backed Spec v2 inputs:

- data models with object cards, relationships, cardinality, and observations;
- system/solution architectures with boundaries and labeled connections;
- interaction sequences with participant lanes and ordered messages.

The extension never queries Salesforce or documentation itself. The caller uses
the owning SF Pi capability, normalizes the evidence, and cites every rendered
element to a declared source. Explicit Mermaid or text requests still win.

## Commands

| Command               | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `/sf-tldraw`          | Open SF tldraw in the SF Pi Manager        |
| `/sf-tldraw status`   | Check local Canvas API and skill readiness |
| `/sf-tldraw settings` | Open diagram presentation defaults         |
| `/sf-tldraw help`     | Print tool and reference guidance          |

## Canvas actions

`tldraw_canvas` supports `status`, `documents`, `create_document`, `cheatsheet`,
`render_salesforce_data_model`, `render_salesforce_architecture`, and
`render_salesforce_sequence`. Generic canvas scripting, search, standalone
screenshots, and long-tail operations remain with the upstream app-owned
`tldraw-offline` skill.

`create_document` uses tldraw's native Documents-directory route and never
overwrites or creates a file implicitly during render. `preserve` updates managed
content without moving human annotations; `relayout` moves managed groups; and
`replace` rebuilds only shapes marked as SF tldraw-managed.

Deterministic profiles bound diagram size and verify layout, labels, bindings,
connector terminals, cardinality decorations, lints, and screenshot evidence.
Unknown Spec v2 fields are rejected rather than silently ignored.

## Configuration

Project → global → default settings cover:

- cardinality detail: `simplified` or `full`;
- card fill: `transparent` or `family`;
- LDV threshold: `1M`, `2M`, `5M`, or `10M`;
- record types: `off`, `auto`, or `always`;
- relationship legend: `show` or `hide`.

Per-render arguments override saved defaults. Inherit/default choices delete the
scoped field instead of copying a value.

## Safety and Data Boundaries

- Every strict Spec v2 element cites declared evidence; Salesforce facts are
  never inferred or fabricated.
- Rendered strings reject auth material, org ids, usernames/emails, instance
  URLs, and authentication URLs. Execution-only target aliases are neither
  rendered nor persisted.
- A render is complete only after validation, Canvas lints, terminal/typography
  checks, and screenshot capture all pass.
- The local tldraw app owns its bearer token and offline skill. SF Pi reads the
  per-launch token for requests but never prints, persists, bundles, or rewrites
  it.
- No OS automation, browser automation, or direct `.tldraw` archive generation
  is used as a fallback.
- Source screenshots must be regular JPEG/PNG files inside tldraw's dedicated
  temporary capture directory before private artifact copies are exposed.

## References

Use [`docs/README.md`](./docs/README.md) to choose the Spec v2 cheatsheet,
Salesforce icon/color guidance, or profile-specific reference. Operating order,
document selection, preserve/relayout semantics, and completion criteria live in
[`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Troubleshooting

**No tldraw document is open:** Create one with `action="create_document"`, then
pass the returned `document_id` to a render action.

**Runtime configuration is stale:** Restart tldraw offline so it rewrites its
per-launch server configuration and token.

**The app-owned skill is missing or stale:** Use **Develop → Install Agent
Skills** inside tldraw offline. SF Pi never overwrites that skill.

**A document reached its page limit:** Reuse an SF tldraw-managed page with
`render_mode="replace"` or open another document explicitly.

**Readiness blocks completion:** Correct the reported spec/layout issue and rerun.
A linted or visually detached render is intentionally not reported complete.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-tldraw/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  CREDITS.md                  ← extension attribution
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

---
id: "0107"
status: accepted
date: "2026-08-19"
---

# SF tldraw validates Spec v2 at execute instead of advertising the union

## Context

ADR 0089 kept one `tldraw_canvas` family tool and three Salesforce render
actions. It also advertised the full Spec v2 family union on the always-visible
`spec` parameter. That union is the execute-time contract, not a useful startup
schema: `validateDiagramSpec()` already accepts an object or JSON text, checks
the family schema, and returns path-level errors. The lazy `cheatsheet` action
and `docs/cheatsheet.md` already exist. Data 360 made the same move in ADR 0027
by keeping `params` as an opaque record and disclosing catalogs on demand.

## Decision

The public `tldraw_canvas.spec` field is an opaque object. The three family
schemas in `spec-schema.ts` remain the single execute-time source of truth.
Invalid specs keep path-level diagnostics and recover through
`action: "cheatsheet"`. Spec v2 is not registered as a skill, injected into the
constitution, or inlined into `AGENT_GUIDE.md`.

Call shape is unchanged: the same render actions still accept the same inline
spec object. A file-path `spec` input is out of scope until reused large specs
are a demonstrated problem.

## Consequences

- Always-visible tool schema no longer expands the three-family Spec v2 union.
- First renders that lack a valid spec must load the cheatsheet, then retry.
- Contributor invariant: advertise the three render actions; validate the three
  family schemas at execute.

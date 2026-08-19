# SF tldraw Agent Guide

Use `tldraw_canvas` for deterministic, editable Salesforce data-model, architecture, and sequence diagrams in the local tldraw canvas.

## Workflow

1. Use `documents` when multiple boards may be open.
2. If none is open, call `create_document` separately and retain its `document_id`.
3. If you do not already have a valid Spec v2 object, call `cheatsheet`, then build a strict `spec_version: "2.0"` Salesforce spec.
4. Ground every semantic object, system, participant, relationship, or interaction in a declared evidence source id.
5. Render with `preserve` by default. Use `relayout` or `replace` only when explicitly requested.
6. Treat a render as complete only when readiness is true, canvas lints are zero, decoration checks pass, and screenshot evidence exists.

## Boundaries

- Never infer or fabricate Salesforce schema, org observations, relationships, or runtime flow.
- Use `grounding.mode="org"` only with current org evidence; otherwise use reference grounding.
- Use `cheatsheet` only when the spec contract is needed.
- Do not use OS automation or direct `.tldraw` archive generation as a fallback.
- Explicit Mermaid/text requests take priority over Canvas rendering.

## Related domain skills

Prefer `tldraw_canvas` for Salesforce canvas diagrams. If it cannot cover the work, read the vendor tldraw skill `tldraw-offline`. For text Mermaid instead of a canvas, read `external-diagram-mermaid-generate`.

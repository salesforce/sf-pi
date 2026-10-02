<!-- SPDX-License-Identifier: Apache-2.0 -->

# Pi terminal Mermaid fallback proposal

## Problem

Pi's interactive Markdown transformer renders a top-level Mermaid fence only when
`grok-mermaid` returns warning-free art that fits the available transcript width.
Three fallback paths currently provide limited recovery information:

| Condition                               | Current transcript result                | Proposed result                                                                       |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Unsupported Mermaid family              | Original source fence                    | Source fence plus `Mermaid diagram not rendered: unsupported diagram type`            |
| Supported but wider than the transcript | Original source fence                    | Source fence plus required and available column counts                                |
| Art with advisory parser warnings       | Original source fence plus first warning | Best-effort art plus the warning, or an explicit documented decision to retain source |

The source fence must remain available for copying. This proposal changes only
presentation-time diagnostics; session source and model context remain unchanged.

## Proposed implementation

In Pi's built-in Mermaid Markdown transformer:

1. Call `diagramKind(source)` when `render(source)` returns `null`.
2. Distinguish unsupported headers from malformed supported diagrams.
3. When art is wider than `context.availableWidth`, report both widths.
4. Align warning handling with `grok-mermaid`'s advisory-warning contract, or
   document why Pi intentionally chooses source over partial art.
5. Keep the existing `off`, `final`, and `streaming` setting behavior.
6. Keep assistant-thinking content excluded.

Suggested public-safe messages:

```text
Mermaid diagram not rendered: unsupported diagram type
Mermaid diagram not rendered: needs 122 columns; 78 available
Mermaid diagram not rendered: syntax error in a supported diagram
```

## Fixture

`extensions/sf-brain/tests/fixtures/pi-mermaid-fallback-cases.json` contains five
small source-only cases:

- supported and fitting;
- supported but too wide;
- unsupported family;
- supported but malformed;
- advisory parser warning.

The fixture contains no session content or identifiers and can be copied into
Pi's renderer tests.

## Acceptance criteria

- The supported fitting case renders as Unicode art.
- Unsupported and malformed cases produce different bounded diagnostics.
- The too-wide case reports required and available columns.
- Warning behavior is explicit and tested.
- No diagnostic is persisted into the session JSONL.
- Streaming does not alternate unpredictably between art and source.
- Existing Mermaid setting modes retain their current semantics.

---
id: "0105"
status: accepted
date: 2026-08-11
---

# ADR 0105: Extension References Are Role-Routed

Extension manifests declare every Markdown reference directory under `docs.referenceRoots`. Each root provides an extension-relative index and a role: `current`, `generated-current`, or `compatibility`. Generated-current roots also name their repository generator. Nested roots override broader roots for lifecycle classification, so compatibility evidence can remain inspectable without entering current-copy guidance.

`docs.primaryFiles` is a separate bounded read-first route for implementation. It starts with `index.ts`, contains at most eight non-Markdown entrypoints, and does not duplicate editing rules, operating guides, glossaries, or deeper references.

The catalog generator fails closed when reference Markdown is uncovered, an index or generator is missing, a role is invalid, or the primary route violates its bound. Generated orientation and extension pages link reference indexes, while current-copy checks include current and generated-current roots and exclude compatibility evidence.

This extends ADR 0006's manifest documentation routing decision. It preserves progressive disclosure: agents locate one owner, read a small implementation route, and open one focused reference index only when the task needs more depth.

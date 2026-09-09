---
id: "0112"
status: accepted
date: 2026-09-09
---

# ADR 0112: SF Docs Separates Protocol Validity from Evidence Outcomes

SF Docs validates JSON-RPC envelopes and each documented action response before interpreting documentation evidence. Transport, envelope, and response-shape violations throw tool errors; expected service and evidence outcomes remain structured results with explicit recovery metadata. Primitive requests use action-specific builders, search and answer omit locale when configured for automatic detection, and explain sends only its documented query, locator, and citation fields.

Fetch results report retrieval as complete, partial, or failed separately from model-facing content truncation. URL recovery succeeds only after the recovered fetch returns usable content, and bounded per-document availability metadata is preserved for recovery. Answer and explain always request citations and return at most 16,000 answer characters and 12 bounded citations to the model.

This extends ADR 0065's result-card and evidence-packet boundary: human rendering remains compact, while model evidence is both size-bounded and explicit about source completeness.

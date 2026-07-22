# ADR 0080: Active-Branch Latest Context Projection

Status: accepted

SF Pi will decide hidden model context from the active, compaction-aware session branch rather than from every append-only session entry. Immutable guidance is injected once while it remains live on that branch and is re-injected after compaction removes it. Mutable context—including Salesforce environment, Slack identity, extension/tool availability, and settings-derived Guardrail guidance—is projected so only its latest active-branch value reaches the model.

The append-only session remains the audit and reconstruction record; SF Pi filters only superseded model-visible custom messages during context construction and never filters state-only entries, approval records, or hard Guardrail enforcement. Behavior proof must cover sibling branches, tree navigation, compaction, resume, fork, and A→B→A state changes before dynamic tool loading is adopted.

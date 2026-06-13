# SF Guardrail uses a Safety Kernel

SF Guardrail will center risky-action evaluation in one pure Safety Kernel that turns a normalized Safety Subject into a Guardrail Decision. The kernel owns rule evaluation, fail-closed classification, org-aware risk detection, and Safety Envelope construction; Pi Runtime concerns such as UI prompts, session entries, persisted grants, notifications, and command panels stay outside the kernel.

This keeps the safety behavior testable through one deep interface instead of spreading the product logic across many shallow event-handler seams. Existing helper modules may remain internally where they add locality, but callers should not need to understand separate file-policy, command-gate, org-aware, and approval-scope orchestration to ask whether a tool call is safe.

**Consequences**

Refactors should first preserve current behavior with characterization tests around the Safety Kernel interface. New risk gates must return explicit Guardrail Decisions and Safety Envelopes from the kernel before any human-in-the-loop or persistence code acts on them.

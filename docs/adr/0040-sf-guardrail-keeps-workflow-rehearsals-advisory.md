# SF Guardrail keeps workflow rehearsals advisory

SF Guardrail will hard-enforce true safety boundaries, but workflow-quality improvements such as deploy rehearsal, check-only deploys, Savepoint + rollback patterns for anonymous Apex, and audit-inspection hints will remain advisory recovery guidance by default. The absence of an ideal rehearsal should not by itself block a risky operation that is already routed through the appropriate Guardrail Decision and Human-in-the-Loop Approval.

This keeps SF Guardrail powerful without over-policing normal agent work. Hard gates are reserved for protected files, secret access, credential reveal, dangerous local commands, and production-sensitive Salesforce mutations. Advisory guidance can still steer agents toward safer patterns in prompts, block reasons, confirmation copy, and command output.

**Consequences**

Future rehearsal enforcement, such as requiring a prior deploy validation before production deploy, needs a separate decision because it would add session-history reasoning and more false-positive risk. Until then, tests should verify that rehearsal hints are present where useful, not that missing rehearsals block execution.

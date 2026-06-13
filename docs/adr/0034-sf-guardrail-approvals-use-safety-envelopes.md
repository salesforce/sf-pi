# SF Guardrail approvals use Safety Envelopes

SF Guardrail human approvals grant a Safety Envelope rather than trusting a raw command string or creating a blanket allow. The envelope must describe the risk gate, project scope when relevant, verified Salesforce org identity when relevant, operation family, TTL for persisted grants, and any safety-relevant target details.

This refines ADR 0032: persisted approval grants remain risk-tiered, but the core approval model is envelope-first for both session approvals and persisted grants. Exact-command approvals are still valid for broad local dangerous commands; production deploys may use a verified org + project + deploy-family envelope; production data mutation, anonymous Apex, destructive REST, guessed-org operations, and credential-reveal commands should remain narrow and generally prompt every time.

**Consequences**

Human-in-the-loop copy must explain what the approval covers before asking the user to allow it. Tests should assert the Safety Envelope for each gated operation, not only that a command matched a rule. New approval shortcuts must be rejected unless their envelope is narrow, understandable, auditable, and fail-closed when org or project identity is ambiguous.

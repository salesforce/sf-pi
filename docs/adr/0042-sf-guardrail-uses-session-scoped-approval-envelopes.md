# SF Guardrail uses session-scoped approval envelopes

SF Guardrail will replace minute-based persisted approval grants with session-scoped Safety Envelope approvals. Human approval should suppress repeat prompts for the same narrow envelope during the current Pi session path, but it should not create a wall-clock grant that can surprise the user later.

This keeps SF Pi powerful enough to perform dangerous operations after human approval while reducing prompt fatigue in the active task. Session scope matches how agents work: a human is usually approving a bounded investigation, deploy, cleanup, or verification task. `/sf-guardrail forget` remains the user-facing way to revoke active approvals for the current branch/project context.

**Consequences**

Approval copy should say "for this session" rather than "for N minutes". Persisted approval storage should be retired or ignored for new decisions. Safety Envelopes still matter: approvals must remain scoped to the same project, verified org identity when relevant, operation family, and exact subject when needed.

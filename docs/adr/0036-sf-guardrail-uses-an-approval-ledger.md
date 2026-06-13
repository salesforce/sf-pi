# SF Guardrail uses an Approval Ledger

SF Guardrail will treat audit entries, session approvals, revocation markers, persisted approval grants, grant lookup, grant creation, and recent-decision reads as one Approval Ledger seam. The implementation may keep small private helpers, but callers should interact with one deep module that answers what approvals exist, what Safety Envelopes they cover, and what Guardrail Decisions have been recorded.

This keeps human-in-the-loop behavior local and understandable. Without a ledger seam, approval scope, audit rendering, session memory, and persisted grants drift across separate modules, making it harder for agents and maintainers to prove that an approval covers only the intended Safety Envelope.

**Consequences**

Future refactors should move approval-memory orchestration behind the Approval Ledger before changing prompt or settings behavior. Tests should verify ledger behavior through Safety Envelopes and outcomes rather than by coupling to separate storage helpers.

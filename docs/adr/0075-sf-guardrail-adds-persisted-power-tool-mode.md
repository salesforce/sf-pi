# SF Guardrail adds persisted Power Tool Mode

SF Guardrail remains HITL-first by default, and per-rule Rule Behavior still controls whether a risk is off, confirmable, or hard-blocked. To support SF Pi as a pro-code developer tool, Guardrail will add an explicit persisted Power Tool Mode for advanced users that can auto-approve confirm-class decisions while preserving hard blocks and auditability.

Power Tool Mode is off by default. It supports a native-tool-only scope with per-native-family selection, and an all-confirm-class scope for users who intentionally want broader automation. Production or Unknown Org auto-approval remains a separate opt-in that defaults off. Power Tool Mode may auto-approve allow-once-only envelopes, but every auto-approval is recorded in the Guardrail Audit Trail and hard blocks are never bypassed.

**Consequences**

ADR 0052 remains the default safety posture, but this ADR supersedes its prohibition on broad persisted posture controls for this one explicit power-user feature. The UI must make the mode visible and warning-styled in `/sf-guardrail` and in the SF Pi Manager settings surface. The model cannot enable it through a tool parameter; users configure it through Guardrail settings or explicit operator-controlled configuration.

# SF Guardrail defaults to confirmable Power Tool mode

> Superseded by ADR 0052. SF Guardrail no longer has bulk posture modes; per-rule Rule Behavior is the only safety model.

SF Guardrail will default to a Power Tool posture: risky actions should be human-confirmable rather than hard-blocked by default. The human remains the authority to override after SF Guardrail explains the risk, Safety Envelope, target org context, and safer workflow guidance.

Hard blocks remain useful for users and teams that want a stricter posture, but they should be opt-in through simple hard-block themes or settings rather than the default behavior. This keeps SF Pi powerful for expert workflows while preserving safety through human-in-the-loop confirmation and auditability.

**Consequences**

Default bundled behavior should move toward confirmable decisions for risky categories, including protected files and credential-reveal commands, unless a selected hard-block theme says otherwise. Secret-file confirmations must clearly warn that approval may expose sensitive values to the model/transcript and should recommend safer alternatives such as example files, environment-backed secrets, or `/login` flows.

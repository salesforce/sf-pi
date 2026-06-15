# SF Guardrail

SF Guardrail is the safety context for mediating risky agent actions in SF Pi. It exists to keep Salesforce-oriented work safe without turning the extension into a general-purpose policy platform.

## Language

**SF Guardrail**:
The **Bundled Extension** that mediates risky file access, dangerous shell commands, and Salesforce org-sensitive operations in the **Pi Runtime**.
_Avoid_: generic guardrails, policy platform, security scanner, Salesforce org policy engine

**Safety Mediator**:
The product posture where **SF Guardrail** evaluates risky agent actions and returns a clear allow, block, or human-approval decision. It is opinionated and narrow rather than a configurable policy platform.
_Avoid_: policy engine, governance framework, rule marketplace, shell sandbox

**Power Tool Mode**:
The default SF Guardrail posture where risky actions are human-confirmable rather than hard-blocked. The human can override after reviewing the **Safety Envelope** and risk guidance.
_Avoid_: unsafe mode, trust mode, disabled guardrail

**Rule Behavior**:
The per-rule setting that decides whether a risk is off, human-confirmable, or a non-overridable hard block. The settings UI presents these as Off, Ask me, and Block.
_Avoid_: enabled flag, theme, policy mode

**Hard-Block Theme**:
A user-facing preset that applies a set of **Rule Behaviors**. It is a shortcut for common setups, not the underlying configuration model.
_Avoid_: policy engine, security profile, admin policy, rule marketplace

**Strict Theme**:
An opt-in **Hard-Block Theme** that sets selected sensitive rules to hard block while leaving other rules human-confirmable.
_Avoid_: default mode, compliance engine, global policy

**Safety Kernel**:
The pure decision module that evaluates a **Safety Subject** and returns a **Guardrail Decision** without performing Pi Runtime UI, session, or persistence side effects.
_Avoid_: event handler, policy engine, approval manager, command panel

**Guardrail Decision**:
The outcome of evaluating a risky agent action: allow, block, or ask for **Human-in-the-Loop Approval**.
_Avoid_: policy result, security verdict, scan finding

**Safety Subject**:
The thing being attempted by an agent action, such as file access, a shell command, or a Salesforce org-sensitive operation.
_Avoid_: raw tool call, command blob, policy input

**Risk Gate**:
A narrow safety check that explains why a **Safety Subject** is risky, such as protected file access, a dangerous local command, or a production-sensitive Salesforce operation.
_Avoid_: rule engine, detector, scanner

**Safety Envelope**:
The exact scope covered by an allow decision, such as the risk gate, project, verified org identity, operation family, session path, and safety-relevant target details.
_Avoid_: approval scope, blanket allow, trust mode, bypass, global allowlist

**Org-Aware Gate**:
A **Risk Gate** whose decision depends on the resolved Salesforce org identity and detected org type for a shell command.
_Avoid_: production detector, deploy blocker, org policy engine

**Detected Org Type**:
The Salesforce org type SF Guardrail receives from SF Pi's Salesforce environment detection: scratch, sandbox, developer, trial, production, or unknown.
_Avoid_: demo type, training type, name-based environment guess

**Unknown Org**:
A target org whose type cannot be verified from the available Salesforce/Core org facts. SF Guardrail treats it as production for risky operations.
_Avoid_: assume sandbox, infer from alias name, demo org guess

**Operation Family**:
A small, named class of related actions that may share an approval when the rest of the **Safety Envelope** is unchanged, such as Salesforce metadata deploys to one verified org.
_Avoid_: arbitrary command prefix, broad tool permission, workflow

**Human-in-the-Loop Approval**:
The explicit user confirmation step used when a **Guardrail Decision** cannot be safely allowed or hard-blocked. The approval asks the user to accept a **Safety Envelope**, not to grant general trust.
_Avoid_: silent approval, background prompt, exception

**Approval Ledger**:
The seam that records **Guardrail Decisions** and manages **Session Approvals**, **Persisted Approval Grants**, revocations, and recent decision reads for **Safety Envelopes**.
_Avoid_: audit helper, allowlist, approval store, grant manager

**Session Approval**:
A branch/session-scoped approval that suppresses repeated prompts for the same **Safety Envelope** during the current Pi session path.
_Avoid_: timed grant, permanent allow, global trust, hidden bypass

**Session-Scoped Approval Envelope**:
A **Safety Envelope** that has been accepted by the human for the current Pi session path only. It replaces wall-clock approval grants as the preferred way to reduce prompt fatigue.
_Avoid_: minute-based grant, persisted allow, trust mode

**Persisted Approval Grant**:
A deprecated user-local, TTL-bound approval that could suppress future prompts outside the current session.
_Avoid_: permanent allowlist, trust mode, project policy

**Fail-Closed Outcome**:
The safety posture where ambiguity resolves to block or human approval rather than silent allow.
_Avoid_: best-effort allow, convenience-first safety, optimistic pass

**Guardrail Audit Trail**:
The session-local record of **Guardrail Decisions** and approval outcomes.
_Avoid_: telemetry, analytics, external logging

**Rehearsal**:
A safer, non-committing action used to prove intent or scope before a riskier Salesforce operation.
_Avoid_: dry run as deploy, fake execution, optional ceremony

**Advisory Recovery Guidance**:
A non-blocking instruction that helps the agent recover safely after a block or choose a safer workflow before retrying.
_Avoid_: hard gate, policy requirement, mandatory workflow

**Hard Block**:
A **Guardrail Decision** that refuses an action without asking the user because the selected **Hard-Block Theme** makes that safety boundary non-overridable.
_Avoid_: default refusal, prompt, warning, soft block

**Rule-Derived Guidance**:
The agent-visible SF Guardrail instructions generated from the effective ruleset and runtime config rather than maintained as a separate policy prompt.
_Avoid_: second rule source, hand-maintained policy prompt, duplicated safety docs

**Guardrail Preference**:
A normal user-facing SF Guardrail setting such as feature enablement, confirmation timeout, production aliases, or bundled-rule **Rule Behavior**. Routine **Guardrail Preferences** live in Pi settings under `sfPi.guardrail`.
_Avoid_: rule override, policy config, hidden JSON setting

**Guardrail Settings Surface**:
The user-facing settings experience for routine **Guardrail Preferences** in the SF Pi **Manager Surface**. `/sf-guardrail settings` is a compatibility/help entrypoint, not the mutable settings owner.
_Avoid_: raw rule dump, JSON editor, one-off settings hack

**Advanced Rule Override**:
An expert-level JSON customization that adds or replaces a rule in the effective ruleset by stable rule id. Advanced overrides remain separate from routine Pi settings.
_Avoid_: normal setting, policy platform, team governance system

**Project-Local Rule Override**:
A deferred form of **Advanced Rule Override** that would come from a trusted project's local configuration and affect only that project.
_Avoid_: repo-shared bypass, normal setting, automatic trust

**Mediator Surface**:
A Pi Runtime integration point where SF Guardrail observes, blocks, prompts, or reports without becoming an LLM-callable tool.
_Avoid_: guardrail tool, self-approval API, agent policy command

## Example dialogue

Developer: "The agent wants to run a production deploy. Is that blocked?"

Domain expert: "Not always. Production deploys pass through an **Org-Aware Gate** and require **Human-in-the-Loop Approval** unless the command is only a **Rehearsal**. The approval must describe the **Safety Envelope**."

Developer: "Can users configure SF Guardrail into a full policy engine?"

Domain expert: "No. The canonical posture is **Safety Mediator**. Users can tune narrow behavior, but SF Guardrail should not become a general-purpose policy platform."

Developer: "What happens if the org cannot be verified?"

Domain expert: "That is a **Fail-Closed Outcome**. The action should block or ask the human instead of silently allowing the operation."

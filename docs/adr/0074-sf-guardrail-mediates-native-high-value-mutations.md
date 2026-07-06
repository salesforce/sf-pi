# SF Guardrail mediates native high-value durable mutations

SF Pi is a pro-code tool and must support mutation, so mutation alone is not the safety boundary. SF Guardrail will mediate known high-value durable mutations exposed through bundled first-party LLM-callable tools by normalizing them into Native Tool Safety Subjects and applying the existing Guardrail Decision, Safety Envelope, Approval Ledger, and Human-in-the-Loop Approval flow.

Tool parameters such as `allow_mutation`, `allow_confirmed`, `mutation`, and `dry_run=false` are Execution Intent Flags, not approval. Approval comes from a human accepting a specific Safety Envelope, an existing Session Approval for the same stable bounded operation, or Operator-Approved Headless Mode through `SF_GUARDRAIL_ALLOW_HEADLESS=1`.

**Considered Options**

- Central Guardrail mediation for known high-value durable native mutations — chosen because it preserves a single User Intent Boundary, audit trail, and headless posture without prompting for read-only or local diagnostic actions.
- Per-extension HITL helpers — rejected because approval UX, headless behavior, and audit semantics would drift.
- Blanket prompts for all mutations — rejected because SF Pi is a pro-code tool and this would cause developer fatigue.
- Treat model-supplied `allow_*` flags as approval — rejected because it lets the model self-approve durable writes under the user's authority.

**Consequences**

SF Guardrail remains a Known-Surface Mediator, not a complete mutation sandbox. Native tool classifiers should emit Safety Subjects only for known high-value durable mutations; read-only actions, dry runs, local diagnostics, tests, and pre-commit browser draft state stay prompt-free.

The Native Tool Risk Registry lives in `sf-guardrail` for the first implementation slice. Classifiers should stay small and pure, avoid importing large feature-extension internals, and call no Salesforce, Slack, Data 360, or browser APIs while normalizing a tool call. If a classifier later needs complex shared risk detection, extract a tiny pure helper deliberately rather than introducing per-extension approval systems.

Native Salesforce-tool mediation should reuse the existing org-aware posture: explicit `target_org` first, otherwise the active SF Pi/default org, bounded lookup when needed, and unresolved orgs treated as Unknown Org / production-like for high-value durable mutations. Omitted `target_org` remains allowed for developer ergonomics, but inferred org identity and resolution source must appear in the Safety Envelope and approval copy.

Native-tool mediation runs in SF Guardrail's existing pre-execution `tool_call` hook for the first implementation slice. Tools should not call Guardrail internally to approve themselves; if a future operation cannot be classified before server-side resolution, it should expose a non-mutating plan or dry-run step before the Guardrail-mediated execute step.

The first implementation slice should avoid double prompts. Existing high-value paths that already have explicit interactive confirmation and headless fail-closed behavior can remain on their current confirmation path until they are deliberately migrated into Guardrail. New coverage should prioritize unmediated paths and paths where model-supplied Execution Intent Flags are currently the only execution boundary.

For Data 360, the first slice should focus on raw REST and journey/run paths where `allow_confirmed=true` can move from plan or dry-run into execution. Facade paths that already perform explicit interactive confirmation should not receive a second Guardrail prompt until the confirmation is deliberately migrated into the central Guardrail flow.

`slack_canvas create` and `slack_canvas edit` are first-slice Guardrail-native classifiers rather than new Slack-local confirmation helpers. `slack_send` and `slack_schedule` can keep their existing confirmation behavior until deliberately migrated, but new Slack write gaps should use the central Guardrail mediation path and `SF_GUARDRAIL_ALLOW_HEADLESS=1` for operator-approved headless execution.

Browser mediation should target Committing UI Gestures, not all browser interactions. The first slice should at least classify `sf_browser_click` and `sf_browser_press` when `mutation=true` or the provided reason contains commit-oriented verbs such as save, submit, activate, assign, deploy, enable, disable, delete, or apply. Snapshot-label classification is the preferred hardening path when the latest snapshot metadata is available to Guardrail.

Agent Script publish and activation should be distinct Safety Envelopes. `publish` with `activate=false` is `agent publish`; standalone `activate` / `deactivate` is `agent activation`; and `publish` with `activate=true` is one combined approval with operation family `agent publish+activate`, not two prompts and not covered by a plain publish approval. `provision_agent_user dry_run=false` may be session-approvable only when the envelope includes the target user plus a fingerprint of permission-impacting inputs such as sorted `apex://` action targets; without that fingerprint it should be allow-once.

Anonymous Apex execution must never receive broad operation-family session approval. If session approval is offered outside production-like orgs, it must be exact to the verified org and normalized Apex body fingerprint; production or Unknown Org behavior should align with existing production Anonymous Apex shell-command policy. The regex mutation classifier is only a label for risk copy, not the security boundary.

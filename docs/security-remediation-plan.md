# Security Remediation Plan

This plan records the current remediation direction for SF Pi safety and public-surface cleanup. It is intentionally scoped: SF Pi is a pro-code developer tool and must support mutation. The goal is not to block every mutation or claim complete sandboxing; the goal is to make known high-value durable mutations in bundled first-party LLM-callable tools pass through a consistent user intent boundary.

## Core thesis

Mutation alone is not the safety boundary. The boundary is a known high-value durable mutation initiated through a bundled semantic tool where the model could otherwise self-approve the operation under the user's authority.

SF Guardrail remains a known-surface mediator, not a complete mutation sandbox, policy engine, or security scanner. It mediates risky action surfaces SF Pi owns, observes, and can classify in Pi Runtime.

## Agreed terminology

The SF Guardrail glossary defines the terms used by this plan:

- High-Value Durable Mutation
- Native Tool Safety Subject
- Native Tool Risk Registry
- Execution Intent Flag
- User Intent Boundary
- Operator-Approved Headless Mode
- Stable Bounded Operation
- Known-Surface Mediation
- Committing UI Gesture

See `extensions/sf-guardrail/CONTEXT.md`.

## Safety remediation direction

1. Extend SF Guardrail's existing pre-execution `tool_call` mediation from file and shell subjects to known high-value native tool operations.
2. Add a Guardrail-owned Native Tool Risk Registry inside `extensions/sf-guardrail`.
3. Treat model/tool parameters such as `allow_mutation`, `allow_confirmed`, `mutation`, and `dry_run=false` as Execution Intent Flags, not approval.
4. Use the existing Guardrail Decision, Safety Envelope, Approval Ledger, Human-in-the-Loop Approval, and headless fail-closed flow.
5. Standardize operator-approved headless execution on `SF_GUARDRAIL_ALLOW_HEADLESS=1` for new native Guardrail coverage.
6. Avoid double prompts: existing paths with explicit interactive confirmation and headless fail-closed behavior can remain as-is until deliberately migrated.

## First implementation slice

P1 focuses on unmediated or model-self-approved high-value durable mutations:

- `sf_apex` `anon.run` bodies, including indirect side-effect risks that regex mutation detection cannot prove safe.
- `agentscript_lifecycle` publish, activate, deactivate, publish+activate, and `provision_agent_user dry_run=false`.
- Data 360 raw REST and journey/run paths where `allow_confirmed=true` moves from plan or dry-run into execution.
- `sf_browser_click` and `sf_browser_press` committing UI gestures, starting with `mutation=true` and commit-oriented reasons; snapshot-label classification is preferred hardening when available.
- `slack_canvas create` and `slack_canvas edit`.
- `sf_soql` artifact export, QueryAll / ALL ROWS, and unbounded read overrides.

P1 intentionally excludes read-only actions, dry runs, local diagnostics, local tests, normal local source edits, and pre-commit browser draft state.

## Safety envelope expectations

Session approvals are appropriate only for stable bounded operations. Arbitrary-code, raw-REST, UI-ref-based, external-content, destructive, production, or unknown-org operations should stay exact or allow-once.

Examples:

- Anonymous Apex execution: exact verified org plus normalized body fingerprint only; no broad operation-family approval.
- Agent publish+activate: distinct operation family from publish alone.
- Agent user provisioning: target user plus permission-impacting input fingerprint.
- Data 360 raw REST: method, normalized path, target org, and body fingerprint.
- Browser commits: allow-once by default because refs and UI state are short-lived.
- Slack canvas writes: operation, canvas/title/channel identifiers when available, and content fingerprint.

## Public-surface remediation direction

The LLM gateway functionality should remain, but the public surface should be sanitized:

1. Keep the provider configurable and inert without user-supplied endpoint and credentials.
2. Remove or generalize public docs/comments/tests that expose internal-only classification language, implementation-specific routing details, or exact internal model/provider identifiers where possible.
3. Introduce public-safe environment variable aliases for gateway configuration while keeping legacy aliases for compatibility during a transition.
4. Prefer runtime-discovered model catalogs and generic fixtures in public tests/docs.
5. Expand public-safety checks so new docs/examples avoid internal endpoints, internal-only naming, customer identifiers, Slack links/IDs, org IDs, and secrets.

## Documentation and governance follow-up

After P1 behavior is implemented and tested, update or add:

- `docs/security-model.md` — describes actual shipped safety behavior.
- `docs/secure-development.md` — records CI/security scan and review evidence.
- `docs/public-sanitization.md` — public repo sanitization rules.
- `SECURITY.md` — align vulnerability reporting, supported versions, secure configuration, and safety model links.
- `.github/PULL_REQUEST_TEMPLATE.md` — add HITL, public-surface, and security checklist items.

## Validation criteria

P1 is complete when every known bundled SF Pi native high-value durable mutation in scope has tests proving:

1. It produces a Guardrail Decision before execution.
2. The Safety Envelope contains the relevant operation family, target, and fingerprint/resource details.
3. Model-supplied Execution Intent Flags do not count as approval.
4. Headless execution fails closed without `SF_GUARDRAIL_ALLOW_HEADLESS=1`.
5. Read-only, dry-run, local diagnostic, local test, and pre-commit browser draft actions remain prompt-free.

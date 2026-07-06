---
title: Threat model and secure-design review
description: Threat model, secure-design review evidence, outcomes, and residual risks for SF Pi.
---

# Threat model and secure-design review

This document records the public threat model and secure-design review evidence
for SF Pi. It is intended to support the formal secure-development review record;
it is not a substitute for internal approval, Data Owner classification, or AI
Governance sign-off.

## Review status

- **Review state:** remediation evidence ready for formal security review.
- **Engineering outcome:** known static-review findings in this document's scope
  have been remediated or documented as governance residuals.
- **Approval outcome:** pending formal secure-development review record,
  Data Owner classification, and AI Governance review update.
- **Primary residual governance risks:** LLM Gateway source/test classification,
  formal AI Governance status, and formal secure-design review sign-off.

## System overview

SF Pi is a public Salesforce-focused extension bundle for the pi coding agent. It
adds commands, LLM-callable tools, providers, status surfaces, diagnostics,
Browser Evidence, and safety mediation for Salesforce development workflows.

SF Pi runs on the user's workstation and can interact with systems where the user
has configured credentials or authenticated sessions, including:

- local filesystem and project source
- Salesforce orgs through the Salesforce CLI / `@salesforce/core`
- Data 360 / Data Cloud APIs
- Slack APIs through user-provided tokens
- an authenticated Salesforce browser session through agent-browser
- optional LLM provider / gateway configuration

## Key assets

| Asset                                     | Why it matters                                                                       | Primary protections                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Salesforce org data and metadata          | Can include customer data, configuration, agents, permissions, and production state  | SF Guardrail org-aware and native-tool mediation, Salesforce authorization, explicit target-org resolution  |
| Data 360 resources and tenant ingest data | Can ingest local files and mutate Data Cloud resources                               | Data 360 dry-run/intent gates, Guardrail native-tool mediation, execution-chain audit                       |
| Slack messages/canvases/files             | Can expose or modify collaboration content under the user's identity                 | Slack scope checks, Slack send/schedule HITL, Guardrail mediation for Canvas writes                         |
| Local files and artifacts                 | Can contain source, credentials, query exports, screenshots, logs, or data artifacts | File policy rules, artifact confinement, public-sanitization rules, secret scanning                         |
| Salesforce browser session                | Can commit Setup or Lightning UI changes                                             | SF Browser snapshots/evidence, Guardrail commit gesture classification, browser evidence artifacts          |
| LLM Gateway configuration                 | May describe or connect to an organization-specific model gateway                    | No default endpoint, saved/user-provided config, public-safe env aliases, Data Owner classification pending |
| Guardrail settings and audit              | Defines safety posture and evidence of approvals/blocks                              | Manager settings visibility, audit entries, Power Tool Mode explicit configuration                          |

## Trust boundaries

```text
User / operator
  ↕ approves prompts, configures credentials/settings
Pi runtime + SF Pi extensions
  ↕ tool calls / commands / session entries
Local filesystem
  ↕ source, artifacts, settings, screenshots
Salesforce orgs
  ↕ REST/Tooling/Metadata/Agent APIs
Data 360 tenant / APIs
  ↕ metadata, SQL, ingest jobs, activation/segment/semantic resources
Slack workspace APIs
  ↕ search/read/canvas/send/schedule operations
agent-browser Salesforce browser session
  ↕ authenticated UI actions and screenshots
LLM provider / configured gateway
  ↕ model requests and responses
```

## Threat scenarios and controls

| Threat scenario                                                                                    | Impact                                                     | Controls / remediation                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt-injected text asks the agent to mutate org or external state                                | Unauthorized or unintended durable changes                 | SF Guardrail mediates known high-value native mutations before execution; HITL/default fail-closed; Safety Envelopes; audit                              |
| Model self-approves by setting `allow_mutation`, `allow_confirmed`, `mutation`, or `dry_run=false` | User intent boundary bypass                                | These fields are Execution Intent Flags only; Guardrail approval is separate                                                                             |
| Data 360 tenant ingest uploads local file bytes to tenant without approval                         | Local file disclosure and Data 360 integrity risk          | Tenant ingest create/upload/close require `allow_confirmed=true`; Guardrail mediates confirmed execution; dry-run does not read CSV contents             |
| Mutating Data 360 journey hides child mutations inside one outer approval                          | User approves vague parent action without child visibility | Guardrail details list declared child mutation families; Data 360 records actual executed chain as session audit entry                                   |
| AgentScript lifecycle publishes or activates agents without release boundary                       | Agent behavior changes in org                              | Guardrail mediates publish, publish+activate, activate, deactivate, and live provisioning                                                                |
| Anonymous Apex calls existing mutating org logic without DML in submitted body                     | Indirect mutation bypass                                   | Guardrail mediates every `sf_apex anon.run` by exact org + body fingerprint; regex classifier is label-only                                              |
| Browser click commits a Salesforce UI change with neutral model reason                             | Setup/Lightning state changes without approval             | Browser snapshots publish ref metadata; Guardrail classifies Save/Delete/Activate/etc. labels even without `mutation=true`                               |
| Slack Canvas content is silently created/edited                                                    | External collaboration content rewritten as user           | Guardrail mediates `slack_canvas create/edit` before execution                                                                                           |
| SOQL export writes artifacts outside workspace                                                     | Local file write/disclosure path escape                    | `query.export` rejects absolute/parent/dot/empty paths and writes only under `.sf-pi/exports/soql/`                                                      |
| SOQL QueryAll / unbounded reads disclose broad/deleted data                                        | Sensitive data exposure                                    | Guardrail mediates `query.export`, `query.queryAll`, `ALL ROWS`, and `allow_unbounded=true`                                                              |
| Headless agent run executes confirm-class action without user                                      | Unattended mutation/disclosure                             | Headless confirm-class actions fail closed unless explicitly operator-approved                                                                           |
| Power user disables prompts broadly                                                                | Reduced HITL protection                                    | Persisted Power Tool Mode is explicit, visible, audited, scoped by mode/family, keeps production/unknown opt-in separate, and never bypasses hard blocks |
| Secrets or private identifiers are committed publicly                                              | Credential exposure or internal/customer data disclosure   | Gitleaks/TruffleHog, docs-health public-safety checks, LLM artifact check, public-sanitization guidance                                                  |

## Security design decisions

The main security design decisions are recorded in ADRs and domain glossaries:

- `docs/adr/0033-sf-guardrail-is-a-safety-mediator.md`
- `docs/adr/0034-sf-guardrail-approvals-use-safety-envelopes.md`
- `docs/adr/0035-sf-guardrail-uses-a-safety-kernel.md`
- `docs/adr/0042-sf-guardrail-uses-session-scoped-approval-envelopes.md`
- `docs/adr/0074-sf-guardrail-mediates-native-high-value-mutations.md`
- `docs/adr/0075-sf-guardrail-adds-persisted-power-tool-mode.md`
- `extensions/sf-guardrail/CONTEXT.md`
- `CONTEXT.md`

## Remediation evidence by area

| Area                                  | Evidence                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guardrail native mediation            | `extensions/sf-guardrail/lib/native-tool-risk-registry.ts`, `extensions/sf-guardrail/tests/safety-kernel.test.ts`                                         |
| Data 360 tenant ingest                | `extensions/sf-data360/lib/v2/dispatcher.ts`, `extensions/sf-data360/tests/v2-ingest-jobs.test.ts`                                                        |
| Data 360 journey child audit          | `extensions/sf-data360/lib/v2/dispatcher.ts`, `extensions/sf-data360/lib/v2/tools.ts`, `extensions/sf-data360/tests/v2-tools.test.ts`                     |
| Browser snapshot-label classification | `lib/common/sf-browser-snapshot-state.ts`, `extensions/sf-browser/lib/sf_browser_snapshot-tool.ts`, `extensions/sf-guardrail/tests/safety-kernel.test.ts` |
| SOQL export confinement               | `extensions/sf-soql/lib/export.ts`, `extensions/sf-soql/tests/export.test.ts`                                                                             |
| Prompt-injection mapping              | `docs/prompt-injection-controls.md`                                                                                                                       |
| Secure-development process docs       | `docs/secure-development.md`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`                                                                           |
| Public sanitization                   | `docs/public-sanitization.md`, `scripts/docs-health.mjs`                                                                                                  |

## Validation evidence

Representative validation performed during remediation:

- targeted Vitest suites for SF Guardrail, SF Browser, SF Data 360, SF SOQL, and
  SF LLM Gateway
- TypeScript check: `npm run check`
- generated catalog check: `npm run generate-catalog:check`
- docs health: `npm run docs:health:check`
- docs build: `npm run docs:build`
- formatting: `npm run format:check`
- LLM artifact check: `bash scripts/check-llm-artifacts.sh`
- Salesforce Code Analyzer `Recommended:Security` scan with 0 violations
- targeted Salesforce Code Analyzer scans on changed security-sensitive files
- live Pi runtime smoke tests against a non-production Salesforce org for
  Guardrail mediation and Power Tool Mode behavior

## Residual risks and required approvals

| Residual item                                                                            | Owner / closure path                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Formal Data Owner classification for the public repo and LLM Gateway source/test details | Data Owner under SFSS-DGP-001                                                                     |
| Internal AI Governance Review status and classification update                           | AI Governance process owner                                                                       |
| Formal SFSS-100 secure-development review outcome                                        | Security / secure-design reviewer                                                                 |
| Prompt-injection detection beyond impact mediation                                       | Future design if reviewers require positive input scanning                                        |
| General workstation mutation outside SF Pi-known surfaces                                | Residual risk of pro-code agent tools; managed through user/operator controls and least privilege |

## Review outcome for this artifact

This public artifact records SF Pi's threat model and secure-design remediation
evidence. The engineering remediation is complete for the known static findings
listed above. Formal acceptance remains pending until the internal review systems
record Data Owner classification, AI Governance status, and secure-development
review outcome.

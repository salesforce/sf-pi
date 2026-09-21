---
title: "SF Flow"
description: "Lean Salesforce Flow lifecycle workflows for pi: core-five and org-grounded authoring plans, preventive quality, bounded repair guidance, safe quick fixes, Mermaid topology, check-only validation, guarded activation/deactivation, and targeted Flow tests."
editLink: false
---

# SF Flow

<p class="sfpi-page-lead">Lean Salesforce Flow lifecycle workflows for pi: core-five and org-grounded authoring plans, preventive quality, bounded repair guidance, safe quick fixes, Mermaid topology, check-only validation, guarded activation/deactivation, and targeted Flow tests.</p>

## What it does

Owns the lean Flow lifecycle loop in pi: core-five Flow authoring blueprints with optional bounded org grounding for fields/actions/subflows, preventive data-first quality rules, bounded progress-gated repair guidance, three source-bound safe quick fixes, SFDX project discovery, source-located diagnostics, Mermaid topology, API-native one-file Metadata API check-only validation, explicit one-Flow activation/deactivation with resulting-state verification, targeted Flow test discovery/execution, compact Flow Result Cards, and persisted Flow Artifacts. Normal Pi file tools own business-logic edits; project-wide static analysis remains with Code Analyzer; general metadata deployment remains out of scope.

## Start

Open the extension from its primary command:

```text
/sf-flow
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-flow
/sf-pi enable sf-flow
/sf-pi disable sf-flow
```

## Safety notes

- No startup project scans, org probes, subprocesses, or network calls; the tool registers on session_start and performs work only for explicit actions or a successful Flow file edit.
- Normal Pi read/write/edit tools own Flow business-logic changes; fix.apply is limited to source-bound API-version, Auto-Layout, and unused-variable transformations and refuses stale source.
- validate.check stages one exact Flow in a temporary directory and uses Metadata API checkOnly=true; it never deploys or activates metadata.
- deploy.activate, lifecycle.activate, and lifecycle.deactivate require explicit target_org plus allow_mutation=true, are Guardrail-mediated, refuse production/unknown orgs, perform check-only before mutation, and verify resulting state through REST FlowDefinitionView/FlowVersionView evidence.
- Local-file activation stages an isolated Active copy without changing the repository source; exact-version activation never guesses latest; deactivation deploys FlowDefinition activeVersionNumber=0 and verifies IsActive=false plus ActiveVersionId=null and no remaining scheduled job.
- Flow test execution is API-native, targeted, wait-bounded, and limited to explicit Flow API names or Flow test names; no all-org test default or Flow test suites are exposed.
- Org-grounded author.plan runs only with an explicit target_org and returns bounded read-only object/event fields, matching action contracts, matching subflow contracts, and explicit coverage gaps.
- Automatic edit feedback runs only the bounded local diagnostic subset, never contacts an org, and stops after three rounds or a repeated actionable finding signature.
- Full diagnostics, topology, validation, and test evidence is persisted as Flow Artifacts while model-facing output remains compact.
- Lightning Flow Scanner is a pinned dev-only black-box parity oracle; production sf-flow modules contain no @flow-scanner imports and local findings use independently authored logic and messages.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-flow`
- **Intent:** Build apps
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-flow`
- **LLM tools:** `sf_flow`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `tool_result`, `message_end`, `agent_settled`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-flow/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-flow)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-flow/AGENT_GUIDE.md)
- [Domain glossary](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-flow/CONTEXT.md)

---
title: "SF Agent Script"
description: "Single-plugin lifecycle for `.agent` files: compile diagnostics, native quality, preview, local-first Eval Studio, exact-version release eval, inactive publication, and gated activation."
editLink: false
---

# SF Agent Script

<p class="sfpi-page-lead">Single-plugin lifecycle for `.agent` files: compile diagnostics, native quality, preview, local-first Eval Studio, exact-version release eval, inactive publication, and gated activation.</p>

## What it does

Owns the entire Agent Script lifecycle: compile and quality hardening, structural review, preview, local-first Eval Studio, exact-version release eval contracts, inactive publication, and Guardrail-mediated activation.

## Start

Open the extension from its primary command:

```text
/sf-agentscript
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-agentscript
/sf-pi enable sf-agentscript
/sf-pi disable sf-agentscript
```

## Safety notes

- Compile-on-save stays silent on unsupported files and on failed write/edit results; only enabled edit-time High hardening rules join that feedback.
- Global per-rule quality toggles dynamically control reporting, repair, metrics, and local-file publication gating without a reload.
- Quality cards show every finding header by default; overlong variable descriptions gate publication, while official instruction-template diagnostics remain pre-activation recommendations.
- Eval, trace, preview, and lifecycle calls reuse @salesforce/core / SF CLI auth context; timeout-sensitive HTTP may use bounded native fetch and never logs or persists tokens.
- Local-first: compile and validate run via official @sf-agentscript packages before any network call.
- Apex action preflight uses Salesforce's registered action description for authoritative primitive and wrapper input/output contracts; failed target rows are never hidden behind resolved samples.
- Eval Studio inventories repository EvalSpec JSON and local Run artifacts without Salesforce calls; org/version resolution occurs only after an explicit Run or Release Contract action.
- Eval runs synthesize trace artifacts from inline Evaluation API data by default; explicit trace fetches are idempotent GETs.
- Eval turn artifacts preserve a parsed response sequence for every lastExecution.llmEvents entry without duplicating full prompt bodies; missing get_state evidence is unavailable, never a passing zero, and exact repeated surface sentences are detected even when LLM-event evidence is absent.
- Preview and eval completion cards render bounded full-conversation replays with every user/agent utterance, per-turn path, latency, and integrity proof while keeping LLM-facing tool text compact.
- Generated Voice suites enforce one customer-facing LLM completion per turn; exact-version Voice release contracts refuse designated suites without strict get_state-backed response-integrity evidence.
- Publication always creates an inactive version; activation requires complete exact-org, exact-BotVersion generated-baseline evidence plus the current designated release suite when configured.
- Untested activation is a distinct Guardrail Safety Envelope; acknowledge_untested_activation is intent, never approval.
- 5xx-only retry on POST avoids amplifying server-side overload (no Retry-After contract on the Eval API); client-side Eval API batch timeouts are terminal and configurable through batch_timeout_ms.
- Preview sessions land under .sfdx/agents/** (sf-guardrail carve-out); rest of .sfdx/** stays blocked.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-agentscript`
- **Intent:** Build agents
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-agentscript`
- **LLM tools:** `agentscript_authoring`, `agentscript_preview`, `agentscript_eval`, `agentscript_lifecycle`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`, `agent_settled`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-agentscript)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/docs/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md#troubleshooting) for extension-specific recovery steps.

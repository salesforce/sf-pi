---
title: "SF Agent Script"
description: "Build, validate, preview, test, and publish Agentforce agents without leaving pi."
---

# SF Agent Script

<p class="sfpi-page-lead">Build, validate, preview, test, and publish Agentforce agents without leaving pi.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Agentforce agent authoring</strong><p>Build, validate, preview, test, and publish Agentforce agents without leaving pi.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Catch Agent Script errors before you publish.</div>
<div class="sfpi-benefit-card">Inspect topics, actions, variables, and references quickly.</div>
<div class="sfpi-benefit-card">Preview and regression-test agent conversations from the same workflow.</div>
</div>

## Try it first

Open the Agent Script panel

```text
/sf-agentscript
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-agentscript
/sf-pi enable sf-agentscript
/sf-pi disable sf-agentscript
```

## Common use cases

- Create a new `.agent` bundle from a scaffold.
- Compile and format Agent Script while editing.
- Preview a local agent against a Salesforce org.
- Run repeatable eval specs before activating a new agent version.

## What you get

- Compile, create, inspect, mutate, preview, evaluate, publish, and activate tools for agents.
- Local-first checks before server calls where possible.
- Planner traces and compact failure summaries for debugging conversations.

## Safety notes

- Compile-on-save stays silent on unsupported files and on failed write/edit results.
- Eval, trace, and preview API calls go through @salesforce/core Connection so the active org's auth context is reused; no token leaves jsforce.
- Local-first: compile and validate run via official @sf-agentscript packages before any network call.
- Trace fetches are idempotent GETs; failures are logged and never fail an eval run.
- 5xx-only retry on POST avoids amplifying server-side overload (no Retry-After contract on the Eval API).
- Preview sessions land under .sfdx/agents/** (sf-guardrail carve-out); rest of .sfdx/** stays blocked.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-agentscript`
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-agentscript`
- **LLM tools:** `agentscript_authoring`, `agentscript_preview`, `agentscript_eval`, `agentscript_lifecycle`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-agentscript)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md#troubleshooting) for extension-specific recovery steps.

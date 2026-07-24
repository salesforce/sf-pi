---
title: "SF Code Analyzer"
description: "Run Salesforce Code Analyzer scans and setup checks from pi with agent-friendly report summaries and deferred quality feedback."
---

# SF Code Analyzer

<p class="sfpi-page-lead">Run Salesforce Code Analyzer scans and setup checks from pi with agent-friendly report summaries and deferred quality feedback.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Code quality and security scans</strong><p>Run Salesforce Code Analyzer scans and setup checks from pi with agent-friendly report summaries and deferred quality feedback.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Checks Code Analyzer setup without leaving pi.</div>
<div class="sfpi-benefit-card">Runs explicit scans through the supported Salesforce CLI contract.</div>
<div class="sfpi-benefit-card">Adds readiness-gated deferred scans after agent edit passes.</div>
<div class="sfpi-benefit-card">Keeps full reports as artifacts while giving agents actionable summaries.</div>
</div>

## Try it first

Open Code Analyzer status

```text
/sf-code-analyzer
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-code-analyzer
/sf-pi enable sf-code-analyzer
/sf-pi disable sf-code-analyzer
```

## Common use cases

- Verify Code Analyzer plugin and engine prerequisites.
- Run recommended, security, AppExchange, or custom rule-selector scans.
- List rules before choosing scan selectors.
- Generate effective Code Analyzer configuration for review.
- Run explicit ApexGuru analysis for one Apex file when the target org supports it.

## What you get

- A `code_analyzer` family tool for doctor, run, rules, config, and last-report workflows.
- Session-scoped JSON/YAML report artifacts outside the project by default.
- A standard SF Pi command panel and aggregated doctor contribution.

## Safety notes

- Runs Code Analyzer through the supported Salesforce CLI plugin instead of importing engine internals.
- Writes default reports outside the project tree so automatic or explicit scans do not dirty source control unless output_files are supplied.
- Doctor/setup checks are command/tool driven; no Code Analyzer subprocess runs on the startup critical path.
- V1 does not apply fixes automatically; fixes and suggestions are surfaced for the agent to apply with normal pi file-editing tools.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-code-analyzer`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-code-analyzer`
- **LLM tools:** `code_analyzer`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `tool_result`, `agent_settled`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-code-analyzer/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-code-analyzer)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-code-analyzer/README.md#troubleshooting) for extension-specific recovery steps.

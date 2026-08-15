---
title: "SF Code Analyzer"
description: "Salesforce Code Analyzer workflows for pi: setup readiness, explicit scans, rule discovery, config generation, report artifacts, deferred agent quality passes, and ApexGuru analysis."
editLink: false
---

# SF Code Analyzer

<p class="sfpi-page-lead">Salesforce Code Analyzer workflows for pi: setup readiness, explicit scans, rule discovery, config generation, report artifacts, deferred agent quality passes, and ApexGuru analysis.</p>

## What it does

Wraps the supported `sf code-analyzer` CLI contract with a pi-native command panel and one `code_analyzer` family tool for doctor, run, rules, config, ApexGuru, ApexGuru setup-help, and last-report workflows. Reports are written as session-scoped artifacts outside the project tree by default with summary / inline / file_only output modes. Deferred post-agent local quality scans are readiness-gated and run after the agent finishes an edit pass.

## Start

Open the extension from its primary command:

```text
/sf-code-analyzer
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-code-analyzer
/sf-pi enable sf-code-analyzer
/sf-pi disable sf-code-analyzer
```

## Safety notes

- Runs Code Analyzer through the supported Salesforce CLI plugin instead of importing engine internals.
- Writes default reports outside the project tree so automatic or explicit scans do not dirty source control unless output_files are supplied.
- Doctor/setup checks are command/tool driven; no Code Analyzer subprocess runs on the startup critical path.
- V1 does not apply fixes automatically; fixes and suggestions are surfaced for the agent to apply with normal pi file-editing tools.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-code-analyzer`
- **Intent:** Build agents
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
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-code-analyzer/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-code-analyzer/README.md#troubleshooting) for extension-specific recovery steps.

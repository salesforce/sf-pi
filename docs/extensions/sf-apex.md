---
title: "SF Apex"
description: "API-native Apex lifecycle workflows for pi: authoring guidance, diagnostics, trace/log/watch, Anonymous Apex, and targeted tests."
editLink: false
---

# SF Apex

<p class="sfpi-page-lead">API-native Apex lifecycle workflows for pi: authoring guidance, diagnostics, trace/log/watch, Anonymous Apex, and targeted tests.</p>

## What it does

Owns the lean Apex lifecycle loop in pi: native Apex discovery/preflight, authoring plan hints, Apex-owned diagnostics handoff, API-native trace flags, log fetch/watch/analyze, Anonymous Apex probes, coverage summaries, and targeted test runs. Source edits remain normal Pi file operations; full evidence is persisted as Apex Artifacts while tool output stays compact.

## Start

Open the extension from its primary command:

```text
/sf-apex
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-apex
/sf-pi enable sf-apex
/sf-pi disable sf-apex
```

## Safety notes

- No startup org probes; Salesforce connections are resolved only during explicit sf_apex tool actions.
- Lifecycle actions use @salesforce/core / Tooling REST APIs as the fast native path; missing lifecycle capabilities should become small native actions instead of subprocess fallbacks.
- Trace flags are bounded by a default TTL and can be stopped explicitly.
- Anonymous Apex bodies are classified for mutation-like tokens and require allow_mutation=true when risky.
- Targeted tests are scoped to explicit classes or methods; v1 does not provide an org-wide test dashboard.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-apex`
- **Intent:** Build apps
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-apex`
- **LLM tools:** `sf_apex`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-apex/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-apex)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-apex/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-apex/README.md#troubleshooting) for extension-specific recovery steps.

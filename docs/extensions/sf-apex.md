---
title: "SF Apex"
description: "Author, discover, diagnose, trace, probe, and run targeted Apex tests from pi with API-native workflows."
---

# SF Apex

<p class="sfpi-page-lead">Author, discover, diagnose, trace, probe, and run targeted Apex tests from pi with API-native workflows.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Apex lifecycle workflows</strong><p>Author, discover, diagnose, trace, probe, and run targeted Apex tests from pi with API-native workflows.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Keeps Apex authoring, native discovery, diagnostics, logs, Anonymous Apex, coverage, and targeted tests in one lean workflow.</div>
<div class="sfpi-benefit-card">Uses Salesforce Core plus native Tooling/REST calls as the fast path instead of subprocess stacks.</div>
<div class="sfpi-benefit-card">Renders human-friendly cards with API Call Rails, log timelines, root-cause summaries, and compact agent-facing digests.</div>
</div>

## Try it first

Open the Apex panel

```text
/sf-apex
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-apex
/sf-pi enable sf-apex
/sf-pi disable sf-apex
```

## Common use cases

- Plan an Apex change and identify likely targeted tests.
- Search Apex classes, discover candidate tests, and summarize coverage natively.
- Start a bounded trace and watch for the next Apex log.
- Run Anonymous Apex probes and analyze the resulting log.
- Run specified Apex test classes or methods and inspect failures.

## What you get

- One sf_apex family tool for discovery, authoring guidance, trace/log workflows, Anonymous Apex, coverage, and targeted tests.
- Human-friendly Apex Result Cards with API Call Rails, Apex Log Timelines, Root Cause sections, File Gates, and Test Run summaries.
- Apex Artifacts under the global agent directory for raw logs, digests, Anonymous Apex bodies/results, and test results.

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
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-apex`
- **LLM tools:** `sf_apex`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-apex/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-apex)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-apex/README.md#troubleshooting) for extension-specific recovery steps.

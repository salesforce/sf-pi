---
title: "SF Feedback"
description: "Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue"
editLink: false
---

# SF Feedback

<p class="sfpi-page-lead">Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue</p>

## What it does

Guided GitHub feedback flow with sanitized diagnostics for SF Pi issues.

## Start

Open the extension from its primary command:

```text
/sf-feedback
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-feedback
/sf-pi enable sf-feedback
/sf-pi disable sf-feedback
```

## Safety notes

- Never submits a GitHub issue without user confirmation.
- Diagnostics are sanitized before preview or submission.
- Headless mode emits a draft and fallback URL only.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-feedback`
- **Intent:** Collaborate and improve
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-feedback`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** _none_

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-feedback)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md#troubleshooting) for extension-specific recovery steps.

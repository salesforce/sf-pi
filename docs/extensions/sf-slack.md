---
title: "SF Slack"
description: "Let agents research Slack context safely and send messages only with explicit user confirmation."
---

# SF Slack

<p class="sfpi-page-lead">Let agents research Slack context safely and send messages only with explicit user confirmation.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Slack search and collaboration</strong><p>Let agents research Slack context safely and send messages only with explicit user confirmation.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Search messages, threads, users, channels, files, and canvases from pi.</div>
<div class="sfpi-benefit-card">Resolve fuzzy Slack references before searching.</div>
<div class="sfpi-benefit-card">Keeps sends human-in-the-loop.</div>
</div>

## Try it first

Open Slack setup/status

```text
/sf-slack
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-slack
/sf-pi enable sf-slack
/sf-pi disable sf-slack
```

## Common use cases

- Find prior discussions related to a bug or feature.
- Summarize threads without leaving pi.
- Resolve people or channels before posting a drafted message.
- Create or edit canvases when explicitly requested.

## What you get

- Slack research, history, thread, channel, user, file, canvas, and send tools.
- Deterministic time-range and entity-resolution helpers.
- Explicit confirmation before any Slack message is posted.

## Safety notes

- slack_send requires user confirmation in interactive mode and refuses headless unless SLACK_ALLOW_HEADLESS_SEND=1.
- slack_schedule schedule/delete require user confirmation in interactive mode and refuse headless unless SLACK_ALLOW_HEADLESS_SEND=1.
- Read-only by default; only canvas create/edit, slack_send, and slack_schedule schedule/delete mutate.
- Tokens are never displayed unmasked.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-slack`
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-slack`
- **LLM tools:** `slack`, `slack_time_range`, `slack_resolve`, `slack_research`, `slack_channel`, `slack_user`, `slack_file`, `slack_canvas`, `slack_send`, `slack_schedule`
- **Providers:** `sf-slack`
- **Events/hooks:** `session_start`, `session_shutdown`, `before_agent_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-slack)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md#troubleshooting) for extension-specific recovery steps.

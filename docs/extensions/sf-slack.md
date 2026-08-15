---
title: "SF Slack"
description: "Slack integration — search messages, read threads, browse channel history"
editLink: false
---

# SF Slack

<p class="sfpi-page-lead">Slack integration — search messages, read threads, browse channel history</p>

## What it does

Full Slack integration. Read-only search/thread/history/channel/user/file/canvas plus confirmed send and scheduled-message management. Tools register only after a token resolves (Pi auth store -&gt; SLACK_USER_TOKEN), keeping the system prompt cache stable when Slack is not configured.

## Start

Open the extension from its primary command:

```text
/sf-slack
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-slack
/sf-pi enable sf-slack
/sf-pi disable sf-slack
```

## Safety notes

- slack_send requires user confirmation in interactive mode and refuses headless unless SLACK_ALLOW_HEADLESS_SEND=1.
- slack_schedule schedule/delete require user confirmation in interactive mode and refuse headless unless SLACK_ALLOW_HEADLESS_SEND=1.
- Read-only by default; only canvas create/edit, slack_send, and slack_schedule schedule/delete mutate.
- Interactive login uses SF Pi's shared fixed-mask component; Pi alone persists and removes API-key or OAuth-compatible credentials.
- Tokens are never displayed unmasked.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-slack`
- **Intent:** Collaborate and improve
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-slack`
- **LLM tools:** `slack`, `slack_time_range`, `slack_resolve`, `slack_research`, `slack_channel`, `slack_user`, `slack_file`, `slack_canvas`, `slack_send`, `slack_schedule`
- **Providers:** `sf-slack`
- **Events/hooks:** `session_start`, `session_shutdown`, `before_agent_start`, `context`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-slack)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md#troubleshooting) for extension-specific recovery steps.

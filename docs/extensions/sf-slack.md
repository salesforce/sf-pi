---
title: "SF Slack"
description: "Full Slack integration. Read-only search/thread/history/channel/user/file/canvas plus send-with-confirm. Tools register only after a token resolves (Pi auth store -> SLACK_USER_TOKEN), keeping the system prompt cache stable when Slack is not configured."
---

# SF Slack

Full Slack integration. Read-only search/thread/history/channel/user/file/canvas plus send-with-confirm. Tools register only after a token resolves (Pi auth store -&gt; SLACK_USER_TOKEN), keeping the system prompt cache stable when Slack is not configured.

## What it is

Slack integration — search messages, read threads, browse channel history

## At a glance

| Property         | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-slack`                                                                                                     |
| Category         | Agent Tool                                                                                                     |
| Maturity         | stable                                                                                                         |
| Default state    | on                                                                                                             |
| Runtime surfaces | commands, tools, provider, events                                                                              |
| Source           | [`extensions/sf-slack/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-slack)                    |
| Full README      | [`extensions/sf-slack/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-slack`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-slack
/sf-pi disable sf-slack
/sf-pi status sf-slack
```

## Runtime surfaces

- **Commands:** `/sf-slack`
- **LLM tools:** `slack`, `slack_time_range`, `slack_resolve`, `slack_research`, `slack_channel`, `slack_user`, `slack_file`, `slack_canvas`, `slack_send`
- **Providers:** `sf-slack`
- **Events/hooks:** `session_start`, `session_shutdown`, `before_agent_start`

## Agent tools

Agents can call these tools when the extension is enabled and configured:

- `slack`
- `slack_time_range`
- `slack_resolve`
- `slack_research`
- `slack_channel`
- `slack_user`
- `slack_file`
- `slack_canvas`
- `slack_send`

## Provider surface

This extension registers provider functionality with pi:

- `sf-slack`

## Safety and privacy

- slack_send requires user confirmation in interactive mode and refuses headless unless SLACK_ALLOW_HEADLESS_SEND=1.
- Read-only by default; only canvas create/edit and slack_send mutate.
- Tokens are never displayed unmasked.

## Configuration and state

Environment inputs:

- `SLACK_USER_TOKEN`
- `SLACK_TEAM_ID`
- `SLACK_ALLOW_HEADLESS_SEND`

State files:

- `Pi auth store via /login sf-slack`
- `session entries: SlackSendAuditEntry, SlackPreferences`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/index.ts)
- [`lib/auth.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/auth.ts)
- [`lib/api.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/api.ts)
- [`lib/tools.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/tools.ts)
- [`lib/research-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/research-tool.ts)
- [`lib/send-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/send-tool.ts)
- [`lib/recipient-confirm.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/recipient-confirm.ts)
- [`lib/config-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/config-panel.ts)
- [`lib/preferences-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/lib/preferences-panel.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-slack)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-slack/README.md#troubleshooting) for extension-specific recovery steps.

---
title: "SF Pi Manager"
description: "Core manager — provides /sf-pi commands"
editLink: false
---

# SF Pi Manager

<p class="sfpi-page-lead">Core manager — provides /sf-pi commands</p>

## What it does

Core manager for the sf-pi package. Provides /sf-pi list/enable/disable/status/display/recommended/announcements/skills/doctor/auto-update commands plus the interactive TUI overlay and settings panel. Pi runtime updates remain user-managed, with newer stable 0.x releases loading in forward-compatibility mode. Opt-in Auto Update waits for agent_settled, updates only declared-compatible unpinned global npm Pi packages through Pi, and runs the independent Salesforce CLI stable update. alwaysActive: enable/disable is mediated through this extension only.

## Start

Open the extension from its primary command:

```text
/sf-pi
```

## Safety notes

- Owns the WRITE side of pi's package filter list via lib/common/sf-pi-package-state.ts.
- Auto Update is opt-in, interactive-session only, agent-settled, machine-locked, abortable, and output-redacted; it never performs an unbounded Pi self-update.
- Package automation is limited to outdated unpinned global npm packages with declared active Pi/Node compatibility; pinned, local, git, project, incompatible, and unverifiable packages are skipped.
- alwaysActive cannot be disabled through the standard toggle action.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-pi-manager`
- **Intent:** Personalize pi
- **Category:** Manager
- **Maturity:** stable
- **Default state:** always-on
- **Commands:** `/sf-pi`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `agent_start`, `agent_settled`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-pi-manager)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md#troubleshooting) for extension-specific recovery steps.

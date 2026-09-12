---
title: "SF Skills"
description: "Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Toggle managed-library invocation via disable-model-invocation stamps on an effective tree. Plus a passive live-context HUD, an expandable first-turn warning with source and setup guidance for unconfigured MCP services declared by agent-invocable managed skills, forcedotcom/sf-skills install, per-skill usage counters, and prune."
editLink: false
---

# SF Skills

<p class="sfpi-page-lead">Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Toggle managed-library invocation via disable-model-invocation stamps on an effective tree. Plus a passive live-context HUD, an expandable first-turn warning with source and setup guidance for unconfigured MCP services declared by agent-invocable managed skills, forcedotcom/sf-skills install, per-skill usage counters, and prune.</p>

## What it does

Skills manager built on the Skill Funnel: a five-tab view (Catalog / Sources / Global / Project / Conflicts) over one resolved Skill Catalog. Source Gate decides which roots Pi sees; Skill Gate toggles individual skills at global and project scope; Skill Conflict Resolution picks a winner by exclusion. Wiring compiles to native settings.skills[]. Managed-library prompt visibility is stamped as disable-model-invocation on a global effective tree so the git clone stays pullable. The first turn emits one expandable human-only warning with source, declared tools, and setup guidance when an agent-invocable managed skill declares an MCP service that is not configured. Plus a passive live-context HUD, forcedotcom/sf-skills install, per-skill usage counters, and prune.

## Start

Open the extension from its primary command:

```text
/sf-skills
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-skills
/sf-pi enable sf-skills
/sf-pi disable sf-skills
```

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-skills`
- **Intent:** Personalize pi
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-skills`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `message_end`, `session_tree`, `session_compact`, `before_agent_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-skills)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md#troubleshooting) for extension-specific recovery steps.

---
title: "SF Skills"
description: "Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Plus a passive live-context HUD, forcedotcom/afv-library install, per-skill usage counters, and prune."
editLink: false
---

# SF Skills

<p class="sfpi-page-lead">Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Plus a passive live-context HUD, forcedotcom/afv-library install, per-skill usage counters, and prune.</p>

## What it does

Skills manager built on the Skill Funnel: a five-tab view (Catalog / Sources / Global / Project / Conflicts) over one resolved Skill Catalog. Source Gate decides which roots Pi sees; Skill Gate toggles individual skills at global and project scope; Skill Conflict Resolution picks a winner by exclusion. Every decision compiles to native settings.skills[] (Compiled Skill Resolution) — no SKILL.md files are ever modified. A Source Registry remembers custom paths and gate state; conflicts that touch an auto-discovered default root are report-only. Plus a passive live-context HUD, forcedotcom/afv-library install, per-skill usage counters, and prune.

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

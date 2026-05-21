---
title: "SF Skills"
description: "Skills manager + passive top-right live-context HUD overlay. Three datatable tabs (Active / Discover / Stats), source detection for global and project Claude/Codex/Cursor roots, an installer for forcedotcom/afv-library that wires the curated SF skills into settings.skills[], persistent per-skill usage counters split by global vs project, and a prune action for stale settings entries + orphan managed clones. Every enable/disable is a native pi settings.skills[] add/remove — no SKILL.md files are ever modified."
---

# SF Skills

Skills manager + passive top-right live-context HUD overlay. Three datatable tabs (Active / Discover / Stats), source detection for global and project Claude/Codex/Cursor roots, an installer for forcedotcom/afv-library that wires the curated SF skills into settings.skills[], persistent per-skill usage counters split by global vs project, and a prune action for stale settings entries + orphan managed clones. Every enable/disable is a native pi settings.skills[] add/remove — no SKILL.md files are ever modified.

## What it is

Manage skills end-to-end: live-context HUD, tabbed datatable (Active/Discover/Stats), Claude/Codex/Cursor source detection, forcedotcom/afv-library install + auto-update, per-skill usage counters, and prune.

## At a glance

| Property         | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-skills`                                                                                                      |
| Category         | UI                                                                                                               |
| Maturity         | stable                                                                                                           |
| Default state    | on                                                                                                               |
| Runtime surfaces | commands, events                                                                                                 |
| Source           | [`extensions/sf-skills/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-skills)                    |
| Full README      | [`extensions/sf-skills/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-skills`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-skills
/sf-pi disable sf-skills
/sf-pi status sf-skills
```

## Runtime surfaces

- **Commands:** `/sf-skills`
- **Events/hooks:** `session_start`, `message_end`, `session_tree`, `session_compact`, `before_agent_start`, `session_shutdown`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/index.ts)
- [`lib/hud-component.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/hud-component.ts)
- [`lib/skill-state.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/skill-state.ts)
- [`lib/table-data.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/table-data.ts)
- [`lib/table-overlay/index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/table-overlay/index.ts)
- [`lib/source-labels.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/source-labels.ts)
- [`lib/classify.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/classify.ts)
- [`lib/defaults.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/defaults.ts)
- [`lib/skills-command.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/skills-command.ts)
- [`lib/settings-coverage.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/settings-coverage.ts)
- [`lib/usage-store.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/usage-store.ts)
- [`lib/prune.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/lib/prune.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-skills)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md#troubleshooting) for extension-specific recovery steps.

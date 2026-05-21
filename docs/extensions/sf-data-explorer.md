---
title: "SF Data Explorer"
description: "Keyboard-first read-only Salesforce data explorer with object/field browsing, editable query text, query execution, result detail view, JSON/CSV export, shortcut help, and explorer switching. Uses sf-pi @salesforce/core connection plumbing; no LLM required."
---

# SF Data Explorer

Keyboard-first read-only Salesforce data explorer with object/field browsing, editable query text, query execution, result detail view, JSON/CSV export, shortcut help, and explorer switching. Uses sf-pi @salesforce/core connection plumbing; no LLM required.

## What it is

Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing.

## At a glance

| Property         | Value                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-data-explorer`                                                                                                             |
| Category         | UI                                                                                                                             |
| Maturity         | experimental                                                                                                                   |
| Default state    | on                                                                                                                             |
| Runtime surfaces | commands, events                                                                                                               |
| Source           | [`extensions/sf-data-explorer/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data-explorer)                    |
| Full README      | [`extensions/sf-data-explorer/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-data-explorer`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-data-explorer
/sf-pi disable sf-data-explorer
/sf-pi status sf-data-explorer
```

## Runtime surfaces

- **Commands:** `/sf-data-explorer`
- **Events/hooks:** `session_start`, `session_shutdown`

## Safety and privacy

- Read-only v1: only describe, query, search, compact Data 360 metadata GETs, and Data 360 SELECT SQL calls are issued.
- Core SOQL execution validates SELECT-only query text before calling /query.
- SOSL execution validates FIND-only query text before calling /search.
- Data 360 SQL catalog loading uses /ssot/metadata-entities; selected object details use /ssot/metadata?entityName=...; /ssot/query-sql is used only to execute the visible SQL query.
- Uses sf-pi target-org and API-version resolution; no hardcoded API version.
- No raw access tokens are surfaced in UI, exports, or logs.

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/index.ts)
- [`lib/transport.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/transport.ts)
- [`lib/command.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/command.ts)
- [`lib/ui/explorer-spa.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/ui/explorer-spa.ts)
- [`lib/modes/soql.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/modes/soql.ts)
- [`lib/modes/sosl.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/modes/sosl.ts)
- [`lib/modes/data360-sql.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/lib/modes/data360-sql.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data-explorer)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md#troubleshooting) for extension-specific recovery steps.

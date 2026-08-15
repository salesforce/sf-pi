---
title: "SF Data Explorer"
description: "Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing."
editLink: false
---

# SF Data Explorer

<p class="sfpi-page-lead">Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing.</p>

## What it does

Keyboard-first read-only Salesforce data explorer with object/field browsing, editable query text, query execution, result detail view, JSON/CSV export, shortcut help, and explorer switching. Uses sf-pi @salesforce/core connection plumbing; no LLM required.

## Start

Open the extension from its primary command:

```text
/sf-data-explorer
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-data-explorer
/sf-pi enable sf-data-explorer
/sf-pi disable sf-data-explorer
```

## Safety notes

- Read-only v1: only describe, query, search, compact Data 360 metadata GETs, and Data 360 SELECT SQL calls are issued.
- Core SOQL execution validates SELECT-only query text before calling /query.
- SOSL execution validates FIND-only query text before calling /search.
- Data 360 SQL catalog loading uses /ssot/metadata-entities; selected object details use /ssot/metadata?entityName=...; /ssot/query-sql is used only to execute the visible SQL query.
- Uses sf-pi target-org and API-version resolution; no hardcoded API version.
- No raw access tokens are surfaced in UI, exports, or logs.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-data-explorer`
- **Intent:** Work with Salesforce orgs
- **Category:** UI
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-data-explorer`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data-explorer)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/AGENTS.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md#troubleshooting) for extension-specific recovery steps.

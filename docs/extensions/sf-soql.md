---
title: "SF SOQL"
description: "API-native SOQL lifecycle workflows for pi: schema search/describe, relationship discovery, query drafting, validation, query plans, bounded query/SOSL execution, exports, file diagnostics, and artifacts."
editLink: false
---

# SF SOQL

<p class="sfpi-page-lead">API-native SOQL lifecycle workflows for pi: schema search/describe, relationship discovery, query drafting, validation, query plans, bounded query/SOSL execution, exports, file diagnostics, and artifacts.</p>

## What it does

Owns the schema-aware SOQL query loop in pi: native org preflight, sObject search/describe, relationship discovery, query drafting, validation, query explain, bounded sample/run/count/queryAll, SOSL run, query export, file diagnostics, history rerun, compact SOQL Run Digests, human SOQL Result Cards, and persisted SOQL Artifacts. Broad data exploration remains with sf-data-explorer; data mutation remains out of scope.

## Start

Open the extension from its primary command:

```text
/sf-soql
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-soql
/sf-pi enable sf-soql
/sf-pi disable sf-soql
```

## Safety notes

- No startup org probes; Salesforce connections are resolved only during explicit sf_soql tool actions.
- Lifecycle actions use @salesforce/core / REST and Tooling APIs as the fast native path; missing recurring capabilities should become small native actions instead of subprocess fallbacks.
- query.sample defaults to a small safe limit. query.run without LIMIT returns a review card unless max_rows or allow_unbounded is explicit.
- query.queryAll and ALL ROWS are explicit and rendered as deleted/archived-row scope warnings.
- query.export is confined to .sf-pi/exports/soql/ under the workspace.
- SOQL results are read-only and artifact-first; sf-soql is not a data mutation or bulk export surface.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-soql`
- **Intent:** Query data
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-soql`
- **LLM tools:** `sf_soql`
- **Providers:** _none_
- **Events/hooks:** `session_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-soql/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-soql)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-soql/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-soql/README.md#troubleshooting) for extension-specific recovery steps.

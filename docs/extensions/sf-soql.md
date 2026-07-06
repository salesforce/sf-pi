---
title: "SF SOQL"
description: "Search schema, draft, validate, explain, sample, run/export SOQL and SOSL from pi with schema-aware native REST/Tooling workflows."
---

# SF SOQL

<p class="sfpi-page-lead">Search schema, draft, validate, explain, sample, run/export SOQL and SOSL from pi with schema-aware native REST/Tooling workflows.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>SOQL query lifecycle workflows</strong><p>Search schema, draft, validate, explain, sample, run/export SOQL and SOSL from pi with schema-aware native REST/Tooling workflows.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Verifies objects, fields, relationship names, field capabilities, literals, and query shape before agents run queries.</div>
<div class="sfpi-benefit-card">Uses Salesforce Core plus native REST/Tooling endpoints for describe, search, query, queryAll, SOSL search, query plan, and artifact export workflows.</div>
<div class="sfpi-benefit-card">Keeps humans in the loop with SOQL Result Cards, API Call Rails, safety gates, compact samples, query export, file diagnostics, and artifact-backed evidence.</div>
</div>

## Try it first

Open the SOQL panel

```text
/sf-soql
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-soql
/sf-pi enable sf-soql
/sf-pi disable sf-soql
```

## Common use cases

- Search for the right object and describe it before writing a query.
- Find relationship names for child-to-parent and parent-to-child SOQL.
- Draft, validate, and explain a query before running it.
- Run bounded SOQL samples, counts, REST queries, Tooling queries, queryAll queries, and SOSL searches.
- Diagnose .soql files or embedded SOQL in Apex, then export the latest query artifact.

## What you get

- One sf_soql family tool for schema search/describe, relationship discovery, draft, validation, query plans, bounded execution, queryAll, SOSL, export, file diagnostics, and rerun.
- Human-friendly SOQL Result Cards with API Call Rails, validation findings, query-plan signals, safety gates, full-query visibility, and compact sample tables.
- SOQL Artifacts under the global agent directory for raw results, flattened JSON, flattened CSV, summaries, plans, schema evidence, SOSL results, and exports.

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
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-soql`
- **LLM tools:** `sf_soql`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-soql/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-soql)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-soql/README.md#troubleshooting) for extension-specific recovery steps.

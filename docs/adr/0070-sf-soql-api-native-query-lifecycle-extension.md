# ADR 0070: SF SOQL is an API-native Query Lifecycle Extension

## Status

Accepted

## Context

SF Pi needs a first-party SOQL workflow that helps agents safely move through schema discovery, query validation, selectivity analysis, bounded execution, result summarization, and iteration without becoming a generic record browser, data export product, or wrapper around Salesforce CLI query commands. Existing surfaces already cover human data exploration, Data Cloud SQL, Apex lifecycle work, static analysis, and broader data operations, so `sf-soql` must own only the SOQL-specific lifecycle primitives that make agentic query work faster, safer, and easier for humans to inspect.

The Salesforce VS Code SOQL implementation provides useful precedent: SOQL workflows need parser-aware handling, explicit REST versus Tooling API execution, query-plan retrieval through the REST query explain endpoint, special `ALL ROWS` / queryAll routing, header-comment handling for `.soql` files, schema-backed field and relationship intelligence, and readable flattening for relationship and subquery results. Some VS Code packages are public and reusable, while `@salesforce/soql-model` is private/internal; SF Pi should use stable Salesforce npm packages where practical without depending on private implementation packages.

## Decision

`sf-soql` will be a lean **SOQL Lifecycle Extension** with one `/sf-soql` command and one `sf_soql` family tool. The V1 tool owns the core **SOQL Query Loop**: `status`, `org.preflight`, `schema.describe`, `schema.relationships`, `query.validate`, `query.explain`, `query.sample`, `query.run`, `query.count`, `query.queryAll`, `history.last`, and `history.rerun`. Authoring extras such as natural-language query drafting, broad schema search, `.soql` file diagnosis, SOSL, Apex embedded-query diagnosis, managed SOQL LSP integration, explicit export workflows, and Data Explorer handoff can follow after the native lifecycle loop is proven.

`sf-soql` hot paths are API-native through Salesforce connections and REST/Tooling APIs. API-native means the default path resolves credentials through Salesforce Core/CLI auth state but performs query lifecycle work in-process through Salesforce APIs. `sf-soql` should not grow a Salesforce CLI subprocess fallback state machine; recurring CLI drift should become a small native action. REST SOQL execution uses `/query`, Tooling SOQL execution uses `/tooling/query`, explicit queryAll uses `/queryAll`, query plans use `/query?explain=...`, and schema discovery uses `/sobjects` and `/sobjects/{Object}/describe`.

`sf-soql` uses a parser-aware, describe-backed validation approach. V1 should use stable public Salesforce SOQL packages where compatible and maintain an SF Pi-owned query-shape model and **SOQL Run Digest**. It must not depend on private `@salesforce/soql-model`. A managed SOQL language server is optional later if parser plus describe validation proves insufficient.

Read-only execution is bounded and artifact-first. `query.sample` defaults to a small safe limit. `query.run` respects explicit small limits or explicit `max_rows`; broad queries without a limit return a review card recommending `query.count`, `query.explain`, or `query.sample` unless the caller opts into a bounded run. `ALL ROWS` is normalized into explicit queryAll behavior and called out in the result card. Full raw and flattened results are stored as **SOQL Artifacts**, while LLM-facing content remains compact.

Human-facing output is a **SOQL Result Card** rendered from a normalized **SOQL Run Digest**. Cards include a compact **SOQL API Call Rail** directly under the title with concrete native endpoints and high-signal parameters. Result cards show validation findings, query-plan signals, safety gates, compact sample rows, and artifact pointers without dumping full result sets into chat.

## Consequences

- `sf-soql` is not a data explorer, record browser, report builder, bulk export product, Data Cloud SQL tool, or data mutation surface.
- Full interactive result browsing remains with `sf-data-explorer`; broader data operations remain outside `sf-soql`.
- Query execution is allowed only as part of the **SOQL Query Loop** and stays read-only, bounded, and artifact-first.
- V1 prioritizes schema describe, relationship discovery, validation, explain, sample, count, run, queryAll, rerun, result flattening, artifacts, and cards over broader authoring features.
- REST versus Tooling API mode remains explicit so advanced users can query Tooling objects without confusing them with data objects.
- Query-plan retrieval is explicit through `query.explain` and may be risk-triggered during validation; it is not silently run before every query.
- `ALL ROWS` / queryAll behavior is explicit and visible to humans.
- `sf-soql` should use public, stable Salesforce npm packages where possible and avoid private VS Code internal packages.

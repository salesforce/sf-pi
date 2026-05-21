# AGENTS.md — sf-data-explorer

Repo-level SF Pi rules apply when this package is merged into `salesforce/sf-pi`.

## Read first

1. `extensions/sf-data-explorer/README.md` — behavior and safety model
2. `extensions/sf-data-explorer/index.ts` — extension wiring
3. `extensions/sf-data-explorer/lib/transport.ts` — sf-pi dynamic transport adapter
4. `extensions/sf-data-explorer/lib/ui/explorer-spa.ts` — TUI component
5. `extensions/sf-data-explorer/lib/modes/*.ts` — SOQL, SOSL, and Data 360 strategies
6. `extensions/sf-data-explorer/tests/*.test.ts` — regression coverage

## Conventions

- Keep v1 read-only. Do not add DML, Apex execution, Metadata API writes, or Data 360 mutation endpoints.
- Do not import `@salesforce/core`, jsforce, or SDR statically. Use sf-pi common connection plumbing through lazy dynamic imports.
- Keep boot path cache-first: no live org calls during module load, extension factory execution, or `session_start`.
- Use `/ssot/metadata-entities` for Data 360 object lists and `/ssot/metadata?entityName=...` for selected-object details.
- Use `/ssot/query-sql` only to run the user's visible Data 360 SQL query.
- Add or update tests with every behavior change.
- Keep examples generic and public-safe; do not include real org aliases, instance URLs, customer data, internal links, or secrets.

## Non-goals

- Mutating data.
- Replacing `sf-data360` facade/tools.
- Generating a complete query language parser.
- LLM-dependent behavior for basic browse/build/run/export workflows.

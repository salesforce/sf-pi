# SF Data Explorer

Read-only interactive Salesforce data explorer for Pi and SF Pi.

## Command

```text
/sf-data-explorer
/sf-data-explorer soql my-org
/sf-data-explorer sosl my-org
/sf-data-explorer sql my-org
/sf-data-explorer soql Account my-org
/sf-data-explorer sosl Contact my-org
/sf-data-explorer sql ssot__Individual__dlm my-org
```

## What It Does

SF Data Explorer is a deterministic, keyboard-first TUI for Salesforce data exploration. It opens a three-pane explorer (objects, fields, query/result) across three read-only modes:

- **`soql`** — browse queryable core Salesforce sObjects, select fields, edit and run SOQL.
- **`sosl`** — browse searchable sObjects, build and run SOSL searches.
- **`sql`** — browse Data 360 DMO/DLO catalogs, select fields, edit and run Data 360 SELECT SQL.

It is not a query author for the agent, a write surface, or a replacement for `/sf-data360`. It is a single explorer for picking data and running read-only queries from inside Pi.

## Runtime Flow

```
Extension loads
  ├─ registers /sf-data-explorer
  ├─ clears local explorer cache on session_start
  └─ does not call any Salesforce API on the boot path

/sf-data-explorer
  ├─ UI available + no args → open SF Data Explorer in the SF Pi Manager
  ├─ selected Manager open action closes the Manager, then opens the explorer UI
  └─ selected Manager help action drills into a read-only help page

/sf-data-explorer <mode> [object] [target-org]
  ├─ lazy-loads sf-pi shared Salesforce connection/REST helpers (connFromAlias,
  │   connRequest, buildApiPath, resolveApiVersion, detectEnvironment)
  ├─ resolves target org and API version
  ├─ loads the mode's catalog (cache-first), populates the object pane
  ├─ on object selection, loads describe/metadata fields, populates the field pane
  ├─ builds an editable query from selected fields + WHERE + LIMIT
  ├─ validates SELECT-only (SOQL/SQL) or FIND-only (SOSL) before any execution
  └─ runs the query, normalizes the result, renders it in the result pane
```

- The extension registers `/sf-data-explorer` at startup and does not perform live org calls on the boot path.
- On explicit command invocation, it lazy-loads sf-pi shared Salesforce connection and REST helpers, then resolves the target org/API version.
- The TUI opens a deterministic three-pane explorer: objects, fields, query/result.
- SOQL and Data 360 SQL validators require `SELECT`; SOSL validator requires `FIND`.
- Results can be browsed in-table, opened in detail, copied, or saved as JSON/CSV.

## Behavior Matrix

| Event/Trigger                           | Condition                            | Result                                                             |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| extension load                          | pi version supported                 | Register `/sf-data-explorer`; no Salesforce probe                  |
| `session_start`                         | extension enabled                    | Clear local explorer cache and transport cache                     |
| `session_shutdown`                      | extension enabled                    | Clear local explorer cache and transport cache                     |
| `/sf-data-explorer`                     | UI available + no args               | Open SF Data Explorer in the SF Pi Manager                         |
| Manager open action                     | selected from extension detail       | Close Manager first, then open the screen-hungry explorer UI       |
| `/sf-data-explorer`                     | direct internal fallback             | Open direct mode picker                                            |
| `/sf-data-explorer soql [object] [org]` | explicit                             | Load SOQL catalog, optionally deep-link to object, open explorer   |
| `/sf-data-explorer sosl [object] [org]` | explicit                             | Load SOSL searchable catalog, optionally deep-link, open explorer  |
| `/sf-data-explorer sql [entity] [org]`  | explicit                             | Load Data 360 DMO+DLO catalog, optionally deep-link, open explorer |
| `/sf-data-explorer <mode> refresh`      | explicit                             | Force-refresh the catalog past cache                               |
| `r` (run) in TUI                        | query text validated as read-only    | Execute query against `/query`, `/search`, or `/ssot/query-sql`    |
| `r` (run) in TUI                        | query text fails read-only validator | Refuse to execute; show validator message                          |
| `s` (save) in TUI                       | explicit                             | Save current result as JSON/CSV under `.sf-data-explorer/exports/` |
| `c` (copy) in TUI                       | explicit                             | Copy current query text into the host editor                       |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data-explorer/
  lib/
    modes/
      data360-sql.ts        ← implementation module
      soql.ts               ← implementation module
      sosl.ts               ← implementation module
    ui/
      explorer-spa.ts       ← implementation module
    cache.ts                ← implementation module
    command.ts              ← implementation module
    export.ts               ← implementation module
    result-normalize.ts     ← implementation module
    text.ts                 ← implementation module
    transport.ts            ← implementation module
    types.ts                ← implementation module
    validators.ts           ← implementation module
  tests/
    boot-path.test.ts       ← unit / smoke test
    builders.test.ts        ← unit / smoke test
    command.test.ts         ← unit / smoke test
    data360-metadata.test.ts← unit / smoke test
    export.test.ts          ← unit / smoke test
    result-normalize.test.ts← unit / smoke test
    strategies-transport.test.ts← unit / smoke test
    validators.test.ts      ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Safety

V1 is read-only by construction:

- Core Salesforce calls: `/sobjects`, `/sobjects/{name}/describe`, `/query`, `/search`.
- Data 360 calls: `/ssot/metadata-entities`, `/ssot/metadata`, `/ssot/query-sql` with SELECT SQL.
- No DML, Apex execution, Metadata API writes, or Data 360 mutation endpoints.

## Shortcuts

Press `?` in the TUI for the complete shortcut list. Primary bindings are lowercase:

```text
t switch explorer
w WHERE/search term
l LIMIT
e edit query
r run
c copy
s save
f refresh
q close
```

## Testing Strategy

Run targeted checks while iterating:

```bash
npm run check
npm test -- extensions/sf-data-explorer
```

The test suite covers:

- Command-line argument parsing (`tests/command.test.ts`).
- SOQL / SOSL / Data 360 SQL query builders (`tests/builders.test.ts`).
- Read-only validators for SELECT and FIND (`tests/validators.test.ts`).
- Result normalization across the three response shapes (`tests/result-normalize.test.ts`).
- Data 360 metadata catalog parsing (`tests/data360-metadata.test.ts`).
- Export helpers for JSON/CSV (`tests/export.test.ts`).
- Strategy → transport endpoint usage with mocked transport (`tests/strategies-transport.test.ts`).

Before commit, run the repo validation path from the root README/AGENTS guidance.

## Troubleshooting

**`/sf-data-explorer` reports the transport could not be initialized:**
The extension lazy-loads sf-pi Salesforce connection internals. Confirm `sf-pi` itself is installed and the target org is authenticated via `sf org login` / `sf org login web`. Pass `--target-org <alias>` (or the third positional argument) to override the default org.

**Catalog never finishes loading:**
Press `f` to force-refresh past the cache, or rerun with `/sf-data-explorer <mode> refresh`. Large orgs and large Data 360 catalogs can take several seconds the first time; subsequent loads are cache-served.

**Query refuses to run:**
The validator only permits `SELECT` (SOQL / Data 360 SQL) or `FIND` (SOSL). V1 is read-only by construction. Edit the query text (`e`) until the validator accepts it before pressing `r`.

**Exports are not where I expect:**
Saved JSON/CSV files land under `.sf-data-explorer/exports/` in the current working directory, not in the org or sf-pi state directory. Use `c` to copy the query text into the host editor instead.

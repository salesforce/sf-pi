# SF Data Explorer

## What It Does

SF Data Explorer is a deterministic, keyboard-first TUI for read-only Salesforce
data exploration. Its three panes cover objects, fields, and query/results in
three modes:

- **`soql`** — browse queryable Salesforce objects and run visible SOQL.
- **`sosl`** — browse searchable objects and run visible SOSL.
- **`sql`** — browse Data 360 DMO/DLO catalogs and run visible SELECT SQL.

It is a human explorer, not an agent query author, write surface, or replacement
for the `sf_soql` and `data360_*` lifecycle tools.

## Commands

```text
/sf-data-explorer
/sf-data-explorer soql <alias>
/sf-data-explorer sosl <alias>
/sf-data-explorer sql <alias>
/sf-data-explorer soql Account <alias>
/sf-data-explorer sosl Contact <alias>
/sf-data-explorer sql ssot__Individual__dlm <alias>
```

Press `?` for the complete shortcut list. Primary keys are `t` switch mode, `w`
set WHERE/search, `l` set limit, `e` edit, `r` run, `c` copy, `s` save, `f`
refresh, and `q` close.

## Configuration

The Manager Settings page stores direct-command defaults:

- `sfPi.dataExplorer.defaultMode`: `soql`, `sosl`, or `sql`;
- `sfPi.dataExplorer.defaultOrg`: target alias used when a command omits one.

Explicit arguments always win.

## Safety and Data Boundaries

- Core org execution accepts only validated `SELECT` SOQL or `FIND` SOSL and
  uses describe, query, and search endpoints.
- Data 360 execution uses compact metadata reads and visible `SELECT` SQL only.
- No DML, Apex execution, Metadata API write, or Data 360 mutation endpoint is
  available.
- Target and API-version selection comes from shared SF Pi connection logic;
  no API version or access token is exposed in UI, exports, or logs.
- Saved JSON/CSV files land under `.sf-data-explorer/exports/` in the current
  workspace.

## Troubleshooting

**The transport cannot be initialized:** Confirm SF Pi is installed and the
explicit or default org is authenticated.

**Catalog loading does not finish:** Press `f` or rerun with the `refresh`
argument. Large catalogs can take several seconds before their cache is warm.

**A query is refused:** Edit it until the visible text starts with the allowed
read-only form: `SELECT` for SOQL/Data 360 SQL or `FIND` for SOSL.

**Exports are not where expected:** Look under `.sf-data-explorer/exports/` in
the current workspace, or use `c` to copy query text.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data-explorer/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

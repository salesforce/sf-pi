# SF Data 360 Safety

The `data360_*` family tools classify calls by action, method, path, and target
org before executing. Use `dry_run: true` before any confirmed or destructive
action.

## Always safe by default

- Local discovery actions such as `actions.search`, `action.describe`, and
  `examples.get`.
- `GET` requests.
- `data360_query sql.run` for bounded `/ssot/query-sql` queries.
- Metadata search and metadata entity reads.
- Validation/test actions such as `source_schema.test`, CI validation, transform
  validation/prepare, connection tests, and local preview helpers.
- Read-style POST discovery/helper actions such as connection database-schema,
  object, and field discovery plus ML helper queries (`ml.predict`,
  `ml.alerts.query`, and `ml.query_*`).
- `data360_orchestrate *.plan` actions.

## Requires confirmation

- `DELETE` requests always.
- `PATCH` and `PUT` requests when the target org is production or unresolved.
- `POST` action paths that create, run, publish, deploy, undeploy, deactivate,
  cancel, retry, enable, disable, refresh, or invoke arbitrary connection
  actions.
- Personalization create/update actions and mobile preview link creation.
- Machine Learning creates, updates, activations/deactivations, prediction-job
  runs, setup-version mutations, and alert triage updates.
- `data360_orchestrate *.run` actions that perform mutations.
- Raw `data360_api rest.request` calls when the resolved safety decision requires
  confirmation.

## Headless mode

If a call requires confirmation and no UI is available, the tool fails closed
unless the specific reviewed workflow supplies `allow_confirmed: true` and the
underlying safety policy permits it. Do not use broad environment overrides for
unreviewed automation.

## Dry-run first

A dry run returns:

- resolved tool/action
- method and normalized `/services/data/vXX.X/...` path, when REST-backed
- target org and API version
- safety level
- request body or journey steps
- suggested next actions or recovery hints when available

## Production and unknown orgs

Pass the intended target org explicitly. When an explicit non-default target org
is supplied, the tool resolves that org before execution and uses its API version
and org type. Unknown target orgs are treated conservatively.

## Tenant ingest auth

`data360_connect auth.pkce_start`, `auth.exchange`, and
`data360_orchestrate ingest_auth.pkce_interactive` keep Data Cloud ingest tokens
in memory only. Tool results return `authSession.id` and sanitized tenant
metadata, never access tokens, authorization codes, or PKCE verifiers.

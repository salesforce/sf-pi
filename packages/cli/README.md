# SF Pi CLI

Run Apex lifecycle operations from coding harnesses, scripts and CI through JSON.
This package exposes only `sf_apex`. It does not start Pi or an MCP server.

```bash
npm ci
npm run build:cli
node packages/cli/dist/sf-pi.js tools list --json
node packages/cli/dist/sf-pi.js tools describe sf_apex --json
```

`npm run build:cli` builds both workspace packages. To use this unpublished checkout
outside the repository, pack both and install them together:

```bash
npm pack ./packages/apex ./packages/cli
npm install --global <apex-tarball> <cli-tarball>
```

Node 22.19 or newer is required. The CLI depends on `@sf-pi/apex`, which owns the
Apex implementation and runtime dependencies. Neither package requires Pi.

## Apex actions

All 21 Apex actions are available:

- Discovery: `status`, `org.preflight`, `apex.search`, `test.discover`, `test.plan`,
  `test.suites`, `coverage.summary`.
- Planning, diagnostics and source: `author.plan`, `diagnose.file`, `apex.source.get`.
- Trace and logs: `trace.start`, `trace.stop`, `trace.status`, `log.latest`,
  `log.get`, `log.analyze`, `log.watch`.
- Execution: `anon.run`, `test.run`, `test.result`, `test.rerun`.

SOQL, LWC, Flow and Data 360 tools are outside this package's current scope.

`tools describe sf_apex --json` returns the input schema, action availability,
authorization requirements and the path to the bundled Apex operating guide.
That guide also describes native Pi workflows. The SDK and CLI use the
authorization boundary below.
Discovery needs no org or credentials.

## Calling Apex

```bash
sf-pi call sf_apex --input '{"action":"author.plan","intent":"Add a focused service"}'
sf-pi call sf_apex --input '{"action":"log.analyze","file":"debug.log"}' --workspace /path/to/project
sf-pi call sf_apex --input-file request.json --workspace /path/to/project
printf '%s' '{"action":"apex.search","target_org":"ExampleOrg","query":"Service"}' | sf-pi call sf_apex --input -
sf-pi call sf_apex --input '{"action":"test.run","target_org":"ExampleOrg","class_names":["ExampleTest"]}' --allow-effects
```

Exactly one JSON envelope is written to stdout; diagnostics go to stderr.
The envelope includes `schemaVersion`, `ok`, `tool`, `runId`, `runFile` and the
original domain `result.content` and `result.details`.

The CLI reports anonymous compilation/runtime failures and completed failing
tests with `ok: false` and exit 5. Native evidence is preserved, so its nested
`result.details.ok` can remain true when evidence collection succeeded but Apex
execution failed. A queued test run is a successful submission, not proof of
passing tests: poll `test.result` for its outcome. Log analysis reports whether
the analysis succeeded; inspect its digest for errors in the analyzed log.

| Exit | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | Success, including an explicitly queued test job |
| 2    | Invalid command, input, workspace or resume      |
| 3    | Unknown tool or unavailable action               |
| 4    | Missing authorization                            |
| 5    | Apex execution, operation or storage failure     |
| 124  | Timeout                                          |
| 130  | Interrupted                                      |

`--workspace` selects the project for credentials/config resolution and resolves
relative `log.analyze` paths. It is not an OS sandbox. Org operations use the
existing Salesforce connection module and locally authenticated credentials.
Use `target_org` explicitly for reproducible automation.

## Authorization and cancellation

`--allow-effects` authorizes trace changes, `log.watch` (which starts tracing),
Anonymous Apex and targeted test execution for this invocation. The calling
harness must obtain the user's authorization. Mutation-like Anonymous Apex
additionally requires `allow_mutation: true`; that input does not replace the
CLI flag. Replay requires authorization again. No approval policy is persisted.

`--timeout-ms` defaults to 120000 and accepts 1–3600000. SIGINT/SIGTERM interrupt
the call. Shared-session requests receive cancellation, and the CLI exits when
the deadline or interrupt fires. Remote work already submitted, including SDK
Apex test jobs, may continue; cancellation cannot roll it back. Poll known test
run ids afterward if necessary.

## Artifacts and resume

Every call has its own directory under the system temporary directory, or
`--artifact-dir <root>`. Invocation directories and run records are private to the
current user. Artifacts may contain org data or source code. Choose a durable
root when the evidence must survive temporary-directory cleanup.

Pass `--resume <runFile>` to reuse the last test run/specification or trace state.
The tool, canonical workspace and explicit `target_org` must match the previous
call. Use the same explicit org on both calls. `test.rerun` requires a resume file
from a previous test call; `test.result` also accepts an explicit `run_id` without
resume. Each invocation writes a new immutable run file, including when it
returns a completed Apex failure. Timeout/interruption does not produce a new
resume record.

## Typed API

Import the independently installable `@sf-pi/apex` package for programmatic calls:

```ts
import { createApexClient } from "@sf-pi/apex";

const apex = createApexClient({ workspace: "/path/to/project", targetOrg: "ExampleOrg" });
const source = await apex.call({ action: "apex.source.get", class_names: ["Example"] });
console.log(source.result?.details.sources);
```

The CLI imports this package and handles arguments, stdout/stderr and exit codes.
The [Apex API guide](../apex/README.md) describes its types, schemas and custom-host
services. CLI discovery exposes the package's evidence schemas as `actionDetailsSchemas`.

## Local Apex diagnostics

`diagnose.file` needs a Java runtime compatible with your Apex language-server JAR
and a local `.cls` or `.trigger` file. It needs no org authentication. Discovery uses
`SF_LSP_APEX_JAR`/`APEX_LSP_JAR`, `.pi/lsp/apex/`, `~/.pi/agent/lsp/apex/`, or an
installed Salesforce Apex editor extension. Select Java with `JAVA_HOME` or
`SF_LSP_JAVA`. The package does not download Java or the JAR.

Each SDK invocation owns its LSP process and disposes it before returning, including
cancellation and timeouts. Missing prerequisites, server failure and absent diagnostic
responses are reported as unavailable, never as a clean file. Syntax errors preserve
the server's diagnostic ranges and produce outer `ok: false` / CLI exit 5. Local LSP
checks do not replace deployment compilation or org tests.

## Native compatibility and build boundary

Native Pi keeps its original tool schema, renderers, hooks, session state and global
artifact paths. Both native registration and the public API call one Apex dispatcher.
The headless adapter owns private per-call artifacts and outcome interpretation.
The existing LSP engine is shared through a host-independent client manager; native
Pi retains its session pool, while public calls use isolated, bounded pools.

The Apex package build rejects Pi runtime dependencies and unrelated extensions. It
includes Apex plus the shared LSP engine and emits TypeScript declarations. The CLI
build keeps `@sf-pi/apex` as a package import and rejects bundled implementation code.
No `sf-agentic-tools` code or runtime dependency is used.

Validation:

```bash
npx vitest run lib/cli/tests/cli.test.ts extensions/sf-apex/tests
npm run test:cli-package
```

The package smoke test first installs the Apex tarball alone and checks its API
and declarations. It then installs the CLI tarball and checks package resolution,
Apex discovery, local planning and log artifacts without Pi dependencies.
Remote behavior tests use synthetic Salesforce responses; live-org execution is
not established by these checks.

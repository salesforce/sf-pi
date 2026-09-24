# SF Pi Apex API

`@sf-pi/apex` exposes all 21 Apex lifecycle actions through typed JavaScript calls.
The implementation lives in SF Pi's `extensions/sf-apex/public.ts`. This package
contains its build output, declarations, operating guide and runtime dependencies.
It can be installed independently of the CLI and Pi.

## Build and install

From the repository root, with Node 22.19 or newer:

```bash
npm ci
npm run build:apex
npm pack ./packages/apex
```

Install the resulting tarball in a consuming project with `npm install <apex-tarball>`.
Repository development uses npm workspaces; no global link is required.

```ts
import { callApex, createApexClient } from "@sf-pi/apex";

const apex = createApexClient({ workspace: "/path/to/project", targetOrg: "ExampleOrg" });
const source = await apex.call({ action: "apex.source.get", class_names: ["Example"] });
console.log(source.result?.details.sources);

const diagnostics = await callApex(
  { action: "diagnose.file", file: "force-app/main/default/classes/Example.cls" },
  { workspace: "/path/to/project" },
);
console.log(diagnostics.ok, diagnostics.result?.details);
```

## Calls and contracts

`callApex` and `createApexClient().call` infer input requirements and result fields
from the action. `invokeApex` accepts unknown JSON with the same runtime validation
and invocation policy. Importing the API or creating a client performs no Salesforce
connection or language-server startup. Org calls use locally authenticated Salesforce
credentials; select the org with `target_org` or the client's `targetOrg` default.

Calls return `ApexCallResult<Action>`. Native evidence remains under `result` as
`ApexToolResult<Action>`, with `content` and typed `ApexDetails<Action>`.
Check the outer `ok` for execution success: retrieved evidence can describe failed
compilation or tests. Queued tests mean successful submission; use `test.result`
to retrieve the completed outcome.

`apexInputSchema`, `apexInputSchemas` and `apexDetailsSchemas` expose the runtime
schemas behind `ApexInput<Action>` and `ApexDetails<Action>`. `apexActions` describes
availability and authorization requirements. The operating guide is exported as
`@sf-pi/apex/AGENT_GUIDE.md` for callers that need workflow guidance.

## Invocation options

- `workspace` selects the project for credential/config resolution and relative
  file paths. It does not change `process.cwd()` or provide an OS sandbox.
- `allowEffects: true` authorizes trace changes, log watching, Anonymous Apex and
  targeted tests for one call. Obtain user authorization in the calling harness.
  Mutation-like Anonymous Apex additionally requires `allow_mutation: true` in
  the input. Effect authorization cannot be stored as a client default.
- `timeoutMs` defaults to 120000, with a range of 1–3600000. `signal` accepts an
  `AbortSignal`. Cancellation cannot undo remote work already submitted.
- `artifactDir` selects the root for private per-call evidence directories;
  the default is the system temporary directory. Artifacts can contain source
  code and org data. Use a durable root when they must survive temporary cleanup.
- `resume` accepts a previous `runFile`. Tool, canonical workspace and explicit
  `target_org` must match. `test.rerun` requires this record and fresh effect
  authorization. Timeout/interruption does not produce a new resume record.

## Local diagnostics

`diagnose.file` needs a compatible Java runtime and an Apex language-server JAR.
It requires no org authentication. JAR discovery uses `SF_LSP_APEX_JAR` /
`APEX_LSP_JAR`, `.pi/lsp/apex/`, `~/.pi/agent/lsp/apex/`, or an installed Salesforce
Apex editor extension. Select Java with `JAVA_HOME` or `SF_LSP_JAVA`.
The package does not download Java or the JAR.

Each call owns and disposes its language-server process, including on cancellation.
Missing prerequisites or missing diagnostic responses report unavailable. Syntax
errors return `ok: false` with the original ranges and messages. Local checks do
not replace deployment compilation or org tests.

## Custom hosts

`executeApex(input, context)` is the dispatcher also used by native Pi. Supply an
`ApexExecutionContext` with connection, session state, artifact writer and diagnostics
services. This lower level leaves authorization, persistence and error handling to
the host. `ApexToolInput` and `apexToolSchema` retain the native input contract.

`createApexArtifactWriter` writes evidence under a supplied directory.
`createApexDiagnosticsClient` creates an owned diagnostics client; await `dispose()`
when finished. Higher-level `callApex` calls handle this cleanup themselves.

## Package validation and release

`npm run test:cli-package` installs this package alone into a clean temporary project,
checks its API and declarations, then installs and exercises its dependent CLI.

Publish the Apex package before the CLI version that depends on it. Keep the CLI's
`@sf-pi/apex` dependency aligned with the intended Apex package version; the package
smoke test checks that match. Building and packing do not publish either package.

# SF Apex

## What It Does

SF Apex provides an API-native Apex lifecycle through Pi, a typed SDK, and a CLI:

```text
author → diagnose → trace/log/watch → bounded probe → targeted test → fix
```

Normal Pi file tools still own source edits. The `sf_apex` family owns Apex
planning, diagnostics, trace flags, logs, Anonymous Apex probes, targeted tests,
and coverage evidence. Raw logs and reports are stored as Apex Artifacts while
model-visible output stays compact.

In Pi, result cards show the native API rail and action-specific evidence such as log
timelines, root causes, run summaries, file gates, or trace captures.

All three entry points share the same Apex actions and implementation:

| Use it from              | Entry point                                    | Start here                                |
| ------------------------ | ---------------------------------------------- | ----------------------------------------- |
| Pi                       | Bundled `sf-apex` extension and `sf_apex` tool | [Use in Pi](#use-in-pi)                   |
| TypeScript or JavaScript | `@sf-pi/apex`                                  | [Use as a typed SDK](#use-as-a-typed-sdk) |
| Scripts or CI            | `sf-pi` binary from `@sf-pi/cli`               | [Use as a CLI](#use-as-a-cli)             |

## Commands

### Use in Pi

Follow the [SF Pi installation guide](../../docs/install.md), then run `pi` from
your Salesforce project directory. SF Apex is bundled and enabled by default.
Inside Pi, these commands provide navigation and status:

```text
/sf-apex          Open SF Apex in the SF Pi Manager
/sf-apex status   Print extension status
/sf-apex help     Print command and tool usage
```

Ask Pi to perform an Apex task; the agent invokes the `sf_apex` tool. For example:

```text
Fetch the Apex source for Example from ExampleOrg.
Check force-app/main/default/classes/Example.cls for Apex diagnostics.
Run only ExampleTest in ExampleOrg and summarize the results.
```

Pi supplies session state, result cards and Guardrail mediation. Source edits use
normal Pi file tools; the Apex tool supplies planning and execution evidence.

## Use as a typed SDK

`@sf-pi/apex` can be installed independently of Pi and the CLI. The packages in
this checkout are not yet published. With Node 22.19 or newer, build and pack the
SDK from the SF Pi repository root:

```bash
npm ci
npm run build:apex
npm pack ./packages/apex
```

In your consuming project, install the generated tarball. Replace the path and
`VERSION` below with the filename printed by `npm pack`:

```bash
npm install /path/to/sf-pi-apex-VERSION.tgz --registry=https://registry.npmjs.org/
```

Use an ES module (`.mts` for TypeScript or `.mjs` for JavaScript):

```ts
import { createApexClient } from "@sf-pi/apex";

const apex = createApexClient({
  workspace: "/path/to/project",
  targetOrg: "ExampleOrg",
});

const source = await apex.call({
  action: "apex.source.get",
  class_names: ["Example"],
});

if (!source.ok) {
  throw new Error(source.error?.message ?? "Apex source retrieval failed");
}
console.log(source.result?.details.sources);
```

The action determines the required inputs and inferred result fields, including
`details.sources` above. The package ships TypeScript declarations and exports
`ApexInput<Action>`, `ApexDetails<Action>` and `ApexCallResult<Action>`, plus runtime
schemas. `callApex` is available for individual calls; `invokeApex` validates
dynamic JSON inputs. Importing the package or creating a client starts no services.

After obtaining authorization in your application, pass `allowEffects: true`
for each call that runs tests, executes Anonymous Apex or changes tracing:

```ts
const tests = await apex.call(
  { action: "test.run", class_names: ["ExampleTest"] },
  { allowEffects: true },
);
console.log(tests.ok, tests.result?.details);
```

Check the outer `ok` for success; evidence may describe a failed execution.
A queued test run confirms submission; fetch `test.result` for the final outcome.
See the [API guide](../../packages/apex/README.md) for artifacts, resume,
cancellation, runtime schemas and custom hosts.

## Use as a CLI

With Node 22.19 or newer, build both packages from the SF Pi repository root.
Discovery works without an authenticated org:

```bash
npm ci
npm run build:cli
node packages/cli/dist/sf-pi.js tools list --json
node packages/cli/dist/sf-pi.js tools describe sf_apex --json
npm pack ./packages/apex ./packages/cli
```

Install both generated tarballs together, replacing the paths and `VERSION` with
the filenames printed by `npm pack`:

```bash
npm install --global /path/to/sf-pi-apex-VERSION.tgz /path/to/sf-pi-cli-VERSION.tgz --registry=https://registry.npmjs.org/
```

The `sf-pi` binary imports `@sf-pi/apex` and exposes only Apex operations:

```bash
sf-pi call sf_apex --input '{"action":"author.plan","intent":"Add a focused service"}'
sf-pi call sf_apex --workspace /path/to/project --input '{"action":"apex.source.get","target_org":"ExampleOrg","class_names":["Example"]}'
sf-pi call sf_apex --workspace /path/to/project --input '{"action":"diagnose.file","file":"force-app/main/default/classes/Example.cls"}'
sf-pi call sf_apex --workspace /path/to/project --input '{"action":"test.run","target_org":"ExampleOrg","class_names":["ExampleTest"]}' --allow-effects
```

Calls write one JSON response to stdout and diagnostics to stderr. Check `ok` and
the exit code: completed Apex execution failures return `ok: false` and exit 5.
`--allow-effects` authorizes execution or trace changes for that invocation.
See the [CLI guide](../../packages/cli/README.md) for input files, all exit codes,
timeouts, artifact locations and resuming a previous call.

## Actions

- **Readiness and discovery:** `status`, `org.preflight`, `apex.search`,
  `test.discover`, `test.plan`, `test.suites`, `coverage.summary`.
- **Authoring evidence:** `author.plan`, `diagnose.file`, `apex.source.get`.
- **Runtime evidence:** `trace.start`, `trace.stop`, `trace.status`,
  `log.latest`, `log.get`, `log.analyze`, `log.watch`.
- **Bounded execution:** `anon.run`, `test.run`, `test.result`, `test.rerun`.

The active tool schema is the exact parameter reference. Multi-step ordering and
recovery live in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Safety and Data Boundaries

- Startup performs no org probe; connections resolve only for explicit actions.
- Org actions use locally authenticated Salesforce credentials. Choose the org
  with `target_org`, or the SDK client's `targetOrg` default.
- Trace flags have bounded lifetimes and can be stopped explicitly.
- Mutation-like Anonymous Apex requires `allow_mutation=true` and remains
  Guardrail-mediated in Pi.
- SDK and CLI callers authorize execution and trace changes with `allowEffects: true`
  or `--allow-effects` for each call. This includes `log.watch`, which starts tracing.
- Tests are scoped to explicit classes or methods; SF Apex is not an org-wide
  test dashboard.
- Full source, logs, diagnostics, and test evidence remain in artifacts rather
  than being copied wholesale into model context.

## Troubleshooting

**`sf_apex` cannot resolve the org:** Confirm the alias is authenticated and
pass `target_org` explicitly when the intended target is not the current default.

**No log appears during `log.watch`:** Confirm the code path ran after the watch
started. The watch is bounded and does not start an unbounded CLI tail process.

**Anonymous Apex is refused as mutating:** Pass `allow_mutation=true` only when
execution is intentional. Prefer a focused Apex test or rollback-safe probe.

**Local diagnostics are unavailable:** `diagnose.file` requires a compatible
Java runtime and an Apex language-server JAR, but no org authentication. For the
SDK and CLI, select Java with `JAVA_HOME` or `SF_LSP_JAVA`, and the JAR with
`SF_LSP_APEX_JAR` or `APEX_LSP_JAR`. Installed Apex editor extensions and local
LSP directories are also discovered. The packages do not download these
prerequisites; see [local diagnostics](../../packages/apex/README.md#local-diagnostics).
Each SDK/CLI call disposes its language-server process when finished.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-apex/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

# SF Agent Script

## What It Does

SF Agent Script provides one lifecycle for `.agent` files: local-first
scaffolding and compile, deterministic inspection and structural edits, live-org
preview, multi-turn regression evals, inactive publication, and eval-gated
activation.

| Tool                    | Responsibility                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Create, compile/format, inspect, review, and structurally mutate local Agent Script    |
| `agentscript_preview`   | Start/send/end live preview sessions and inspect planner traces                        |
| `agentscript_eval`      | Generate and run regression specs, inspect failures/traces, and resolve versions       |
| `agentscript_lifecycle` | Publish inactive versions, manage activation state, and diagnose/provision agent users |

Normal Pi file tools still own general source edits. Salesforce calls use native
Salesforce libraries and APIs rather than `sf` subprocesses on the hot path.

## Authoring and review

`agentscript_authoring` uses `verb` plus an optional `mode`:

- `create` scaffolds a minimal or Agentforce-default bundle;
- `compile` checks or formats with the official Agent Script packages;
- `inspect` projects structure, context, references, definitions, target
  readiness, quality findings, or a deterministic review;
- `mutate` performs supported AST-safe scalar updates, symbol rename, insertion,
  deletion guidance, and quick fixes.

Compile validity means no severity-1 diagnostic. Quality remains separate:
`inspect/quality` applies the enabled High/Moderate/Low/Info rule catalog, while
`inspect/review` combines compile, structural, target, and quality evidence into
`ready`, `ready_with_warnings`, `blocked`, or `partial`—never a hidden numeric
score.

High findings pause local-file publication unless the current session explicitly
acknowledges the reviewed rule ids. Manager settings can enable/disable stable
quality rules globally without changing compile validity.

## Preview and eval

Preview sends render bounded human trace reports while returning compact model
text plus structured digests and artifact pointers. Multi-turn session replay
retains user/agent utterances, route path, state changes, latency, action
activity, and response-integrity evidence without copying full prompts or action
payloads into model context.

`/sf-agentscript evals` opens the local-first Eval Studio for repository EvalSpec
JSON and persisted run evidence. It supports reviewed suite/scenario runs, exact
reruns, cancellation, release-contract execution, reports, and authoring
handoffs. Source remains JSON and is not edited directly inside the Studio.

Eval seed profiles can resolve one bounded read-only SOQL row from dedicated test
fixtures into context variables at run preflight. Zero, ambiguous, unsafe, or
type-invalid seed results fail before creating the run or calling Evaluation API.
Resolved values stay masked on Studio/source previews and remain confined to
restricted executed/raw artifacts.

Eval runs persist immutable source/executed snapshots and terminal evidence.
Incomplete batches, evaluator failures, step errors, missing state evidence, and
non-2xx batch failures can never become a green empty run. Voice release suites
require strict one-customer-facing-completion evidence per turn.

## Release workflow

1. `agentscript_lifecycle publish` creates an inactive BotVersion.
2. `agentscript_eval run_release` regenerates the current baseline and runs it,
   plus the designated suite when present, against that exact version.
3. `agentscript_lifecycle activate` accepts only complete evidence for the same
   org, BotVersion, baseline identity, and current suite digest.

Missing, failed, partial, wrong-org/version, or stale evidence blocks activation.
`acknowledge_untested_activation=true` requests an emergency path but is only
intent; SF Guardrail owns the distinct human approval.

## Commands

```text
/sf-agentscript                   Open SF Agent Script in the SF Pi Manager
/sf-agentscript doctor            Check SDK, org library, and artifact readiness
/sf-agentscript check <file>      Compile a `.agent` file
/sf-agentscript evals             Open the local-first Eval Studio
/sf-agentscript eval <spec.json>  Run a multi-turn suite directly
/sf-agentscript help              Show command usage
```

## Configuration

Manager settings under `sfPi.agentScript` provide low-risk defaults for preview
mock mode, eval trace mode, eval concurrency, deferred quality analysis, and the
global per-rule quality catalog. Quality controls are global-only and read
dynamically; explicit tool arguments win for one call.

## Safety and Data Boundaries

- Local compile and review run before network-dependent preview, eval, or
  lifecycle work.
- Org calls reuse shared Salesforce authentication and bounded transports;
  tokens remain in process and are never logged or persisted by SF Agent Script.
- Heavy prompts, traces, state, transcripts, eval payloads, and reports remain in
  restricted artifacts; branch state stores pointers and bounded summaries only.
- Publication always creates an inactive version and activation is exact-version
  release-evidence gated.
- Preview sessions use `.sfdx/agents/**`; the rest of `.sfdx/**` remains under
  normal repository protection.

## References

Use [`docs/README.md`](./docs/README.md) for focused transition, Service Agent
user, and diagnostic-parity material. Tool ordering, recovery, linked variables,
preview cleanup, eval failure drill-down, and release lifecycle guidance live in
[`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Troubleshooting

**Agent Script SDK is unavailable:** Run `/sf-agentscript doctor` and inspect the
official package graph.

**Server compile rejects locally valid syntax:** Review the source feature
profile and validate against the intended target org; local packages can know a
feature before its server rollout.

**A preview session is missing:** Use the same `target_org` as session start or
create a fresh session.

**An eval appears stuck:** Inspect the run `status.json` and use a smaller
`batch_timeout_ms` for a bounded local probe.

**Live trace fetch returns no data:** Evaluation sessions can close before the
trace endpoint sees them. Use synthesized trace/failure artifacts retained by the
run.

**Publish or activation fails on the agent user:** Diagnose the Service Agent
user first, then review provisioning in dry-run mode before executing changes.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-agentscript/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

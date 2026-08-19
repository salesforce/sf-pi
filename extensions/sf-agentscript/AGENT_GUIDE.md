# SF Agent Script Agent Guide

Use this guide whenever the user is editing `.agent` files, debugging an Agentforce agent, generating/running regression specs, previewing a local or published agent, or publishing/activating an agent.

## Tools

| Tool                    | Use it for                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Create bundles, compile/check or format `.agent` files, inspect structure/docs/targets/native quality, run deterministic review, and mutate source. Uses `verb` + `mode`.                    |
| `agentscript_preview`   | Start/send/end live preview sessions, fetch planner traces, bulk-end sessions, clean stale preview artifacts, render rich human Preview Trace Reports, and return compact LLM trace digests. |
| `agentscript_eval`      | Generate starter eval specs, run regression suites, drill into failures, synthesize trace artifacts, fetch explicit live traces, and resolve active/latest version ids.                      |
| `agentscript_lifecycle` | Publish, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                     |

## Preferred loop

```text
1. agentscript_authoring { verb:"compile", mode:"check", agent_file }
2. agentscript_authoring { verb:"inspect", mode:"structure", agent_file }
3. agentscript_authoring { verb:"mutate", mode:"...", agent_file, ... }
4. agentscript_authoring { verb:"compile", mode:"check" }
5. agentscript_preview   { action:"start", agent_file }
6. agentscript_preview   { action:"send", message:"..." }
7. agentscript_eval      { action:"generate_spec", agent_file, output_path:"..." }
8. agentscript_lifecycle { action:"publish", agent_file }
9. agentscript_eval      { action:"run_release", agent_file, agent_api_name:"..." }
10. agentscript_lifecycle { action:"activate", agent_api_name:"..." }
```

Read **one** child. Do not load the whole `docs/` folder.

- authoring contract / compile / inspect / mutate / create → [`docs/authoring.md`](./docs/authoring.md)
- preview / trace → [`docs/preview.md`](./docs/preview.md)
- release eval / studio / generate_spec → [`docs/eval.md`](./docs/eval.md)
- activation / agent user → [`docs/lifecycle.md`](./docs/lifecycle.md)

Specialized refs, only when needed: [`docs/transitions.md`](./docs/transitions.md) · [`docs/agent-user-setup.md`](./docs/agent-user-setup.md) · [`docs/DIAGNOSTIC_PARITY.md`](./docs/DIAGNOSTIC_PARITY.md)

## Branch-Durable Tool State

Tool results may carry `details.sf_agentscript_branch_state`. Treat it as a branch-aware pointer layer, not evidence storage.

It may let you omit:

- `agent_file` when exactly one current `.agent` file exists on the branch
- preview `agent_name`/`session_id` when exactly one active preview session exists
- eval `spec_path` or failed `run_id` when exactly one candidate exists

It will not guess when multiple candidates exist. Pass explicit ids when ambiguous.

Heavy artifacts remain on disk:

- preview sessions/traces under `.sfdx/agents/**`
- eval run status/failures/synthesized traces under `.pi/state/sf-agentscript/**`
- optional review reports at `output_path`

## Production observability handoff

When the user asks why a production agent behaved incorrectly, start with `sf-data360` observability data, then reproduce locally with `agentscript_preview`, fix via `agentscript_authoring`, verify with `agentscript_eval`, and ship with `agentscript_lifecycle`.

## Related domain skills

Prefer the Agent Script family tools when they can do the action. If they cannot, read one of these Salesforce skills:
`agentforce-generate` · `agentforce-test` · `agentforce-observe` · `agentforce-architecture-analyze` · `agentforce-bot-upgrade`

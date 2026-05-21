---
title: "SF Agent Script"
description: "Owns the entire Agent Script lifecycle: authoring assist (compile-on-save), first-class compile tool, multi-turn eval against /einstein/evaluation/v1/tests with planner-trace fetching, and progressive-disclosure skill for the LLM."
---

# SF Agent Script

Owns the entire Agent Script lifecycle: authoring assist (compile-on-save), first-class compile tool, multi-turn eval against /einstein/evaluation/v1/tests with planner-trace fetching, and progressive-disclosure skill for the LLM.

## What it is

Single-plugin lifecycle for `.agent` files: in-process compile-on-save diagnostics, an LLM-callable compile tool, multi-turn eval/regression testing against the Salesforce Evaluation API, and a placeholder for the future Agent Script LSP.

## At a glance

| Property         | Value                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-agentscript`                                                                                                           |
| Category         | Agent Tool                                                                                                                 |
| Maturity         | stable                                                                                                                     |
| Default state    | on                                                                                                                         |
| Runtime surfaces | commands, tools, events                                                                                                    |
| Source           | [`extensions/sf-agentscript/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-agentscript)                    |
| Full README      | [`extensions/sf-agentscript/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-agentscript`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-agentscript
/sf-pi disable sf-agentscript
/sf-pi status sf-agentscript
```

## Runtime surfaces

- **Commands:** `/sf-agentscript`
- **LLM tools:** `agentscript_compile`, `agentscript_create`, `agentscript_inspect`, `agentscript_mutate`, `agentscript_preview`, `agentscript_eval`, `agentscript_lifecycle`
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

## Agent tools

Agents can call these tools when the extension is enabled and configured:

- `agentscript_compile`
- `agentscript_create`
- `agentscript_inspect`
- `agentscript_mutate`
- `agentscript_preview`
- `agentscript_eval`
- `agentscript_lifecycle`

## Safety and privacy

- Compile-on-save stays silent on unsupported files and on failed write/edit results.
- Eval, trace, and preview API calls go through @salesforce/core Connection so the active org's auth context is reused; no token leaves jsforce.
- Local-first: compile and validate run via the vendored SDK before any network call.
- Trace fetches are idempotent GETs; failures are logged and never fail an eval run.
- 5xx-only retry on POST avoids amplifying server-side overload (no Retry-After contract on the Eval API).
- Preview sessions land under .sfdx/agents/** (sf-guardrail carve-out); rest of .sfdx/** stays blocked.

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/index.ts)
- [`lib/diagnostics.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/diagnostics.ts)
- [`lib/feedback.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/feedback.ts)
- [`lib/sdk.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/sdk.ts)
- [`lib/inspect.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/inspect.ts)
- [`lib/mutate.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/mutate.ts)
- [`lib/tool-types.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tool-types.ts)
- [`lib/eval/sfap.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/sfap.ts)
- [`lib/eval/normalize.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/normalize.ts)
- [`lib/eval/active-ids.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/active-ids.ts)
- [`lib/eval/orchestrator.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/orchestrator.ts)
- [`lib/eval/eval-client.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/eval-client.ts)
- [`lib/eval/trace-client.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/trace-client.ts)
- [`lib/eval/render.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/render.ts)
- [`lib/eval/persist.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/eval/persist.ts)
- [`lib/preview/client.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/preview/client.ts)
- [`lib/preview/session-store.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/preview/session-store.ts)
- [`lib/tools/compile.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tools/compile.ts)
- [`lib/tools/inspect.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tools/inspect.ts)
- [`lib/tools/mutate.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tools/mutate.ts)
- [`lib/tools/preview.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tools/preview.ts)
- [`lib/tools/eval.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/lib/tools/eval.ts)
- [`skills/sf-agentscript/SKILL.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/skills/sf-agentscript/SKILL.md)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-agentscript)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md#troubleshooting) for extension-specific recovery steps.

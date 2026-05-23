# sf-agentscript editing rules

Read `README.md` before changing behavior. This extension owns the Agent Script developer loop: local authoring, preview, eval, and lifecycle.

## Public LLM tool surface

`sf-agentscript` exposes four family tools:

- `agentscript_authoring`
- `agentscript_preview`
- `agentscript_eval`
- `agentscript_lifecycle`

Do **not** re-register removed single-purpose public authoring tools. The family surface is intentional: keep the model-facing tool list small while preserving domain-focused schemas.

## API shape

- `agentscript_authoring` uses `verb` + `mode`.
- `agentscript_preview`, `agentscript_eval`, and `agentscript_lifecycle` use `action`.
- Do not collapse all Agent Script behavior into one mega-tool.
- Do not add compatibility wrappers for removed authoring tool names.

## Branch-Durable Tool State

- Store branch-state events in `details.sf_agentscript_branch_state`.
- The value is an array of small schema-versioned events.
- Store pointers only: file paths, session ids, run ids, plan ids, version ids, compact status.
- Do **not** store heavy traces, raw eval responses, transcripts, reports, prompts, or logs in branch state.
- Auto-resolution must validate referenced disk artifacts before use.
- Auto-resolution may proceed only when exactly one candidate exists; refuse ambiguity with structured candidates.

## Salesforce and Pi runtime rules

- Prefer direct `@salesforce/core` / SDR / REST APIs over `sf` subprocesses on hot paths.
- Keep startup cache-first: no live org checks during extension load or `session_start`.
- Long-running live-org actions should eventually propagate `AbortSignal`; local SDK checks can remain simple when they are ~10ms.
- Use red-green TDD vertical slices for the public tool rewrite. Do not write all tests first and all implementation second.

## Docs

When shipped behavior changes, update:

- `manifest.json`
- `README.md`
- `skills/sf-agentscript/SKILL.md`
- generated catalog/docs via `npm run generate-catalog`

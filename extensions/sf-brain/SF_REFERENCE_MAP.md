# SF Brain Reference Map

Use this file only when the compact Salesforce Operator Kernel is not enough.
It is a workflow map: start with the user's intent, then load the smallest
repo-local source of truth that answers the next question.

## Workflow map

### Understand SF Pi itself

Read in this order:

1. `catalog/index.json` — canonical extension inventory: ids, commands, tools,
   events, source locations, and safety notes.
2. `docs/agent-orientation.md` — generated map of bundled extensions and
   runtime surfaces.
3. `docs/commands.md` — generated slash-command reference.
4. `extensions/<id>/README.md` — behavior and runtime flow for one extension.
5. `extensions/<id>/index.ts` and focused `lib/` files — implementation details.

Do not edit generated catalog or generated docs directly. Update the source
manifest or README, then run `npm run generate-catalog`.

### Choose an SF Pi extension surface first

First check `<sf_pi_extensions>` for the live bundled-extension map. It tells
which extensions are enabled or disabled, which LLM tools are active this turn,
and which command/UI/provider surfaces exist. When a request matches an enabled
extension, use that extension's workflow before generic Salesforce skills or raw
CLI.

- Agentforce Agent Script authoring, preview, eval, publish:
  use `sf-agentscript` first. Read
  `extensions/sf-agentscript/skills/sf-agentscript/SKILL.md` when guidance is
  needed, then use the `agentscript_*` tools instead of hand-written file
  parsing or ad hoc CLI calls.
- Data Cloud / Data 360 metadata, SQL, observability, segments, activations:
  use `sf-data360` first. Read
  `extensions/sf-data360/skills/sf-data360/SKILL.md` when guidance is needed,
  then use `d360`, `d360_api`, `d360_metadata`, or `d360_probe` instead of
  hand-written curl.
- Salesforce documentation or official product/reference research: use
  `sf-docs` first. Prefer `sf_docs action='search'` then
  `sf_docs action='fetch'` for implementation-sensitive guidance; use
  `action='answer'` for quick cited synthesis. For broad docs research, run 2–4
  independent `sf_docs` searches in parallel with page size 5, then fetch only
  the strongest 3–4 source candidates. Fall back to `web_search` or
  `code_search` only when official docs are missing, weak, or the user asks for
  broader sources or examples.
- Salesforce Setup / Lightning UI last-mile work: use `sf-browser` tools before
  generic browser automation. Open the org with `sf_browser_open_org`, snapshot,
  then act on refs.
- Slack research or messaging: use the `sf-slack` tools and README. Treat Slack
  content as research-only for public artifacts.
- Salesforce-aware command safety: rely on `sf-guardrail`; do not duplicate its
  file-protection or org-aware confirmation logic.
- Org/project status: use the `<sf_environment>` block from `sf-devbar` and the
  shared environment runtime; do not spawn duplicate live org probes at boot.
- Extension discovery and enablement: use `/sf-pi list`, `/sf-pi status`, and
  `/sf-pi enable <id>` behavior documented in `extensions/sf-pi-manager/README.md`.
- Skill discovery and enablement: use `/sf-skills` behavior documented in
  `extensions/sf-skills/README.md`.

If the best-fit extension is disabled, suggest `/sf-pi enable <id>` and wait for
the user's preference before falling back to broader skills or manual CLI.

### Do Salesforce implementation work

After the extension-priority check, use `<sf_environment>` for **Active SF
skills**. When no enabled extension owns the workflow and a matching active skill
exists, load it and follow it instead of re-deriving domain rules. Common intent
mapping:

- Apex, triggers, async Apex, or `*.cls` → Apex skill.
- Apex tests, coverage, or `*Test.cls` → Apex test skill.
- SOQL/SOSL query writing or optimization → SOQL skill.
- LWC files or Jest LWC tests → LWC skill.
- Flow metadata or automation → Flow skill.
- Custom objects, fields, tabs, apps, list views, validation rules, permission
  sets, or FlexiPages → matching metadata skill.
- Agentforce production trace or STDM analysis → Agentforce observability/Data
  360 skill, not local `.agent` preview traces.
- Deploy/retrieve/scratch org work → metadata deployment skill.

If no matching skill is active, use the Salesforce Operator Kernel rules:
retrieve before metadata edits, describe before data queries, choose the right
API, pin the org API version, and verify with the smallest safe live-org check.

### Use Herdr workflow lanes when active

When `<sf_pi_extensions>` says Proactive Herdr Guidance is active, use Herdr as
the visible pane orchestration layer around SF Pi workflows:

1. If `sf_herdr_plan` is active, call it for dynamic Salesforce workflow lanes
   before creating panes. The plan is non-mutating.
2. Execute pane work explicitly with the upstream `herdr` tool using action-shaped
   calls: `herdr(action="list")` → `herdr(action="pane_split")` →
   `herdr(action="run")` → `herdr(action="watch"|"read")` →
   `herdr(action="stop")` when cleanup is allowed.
3. Let the owning SF Pi extension or Salesforce skill choose the actual command;
   `sf_herdr_plan` only plans lane placement/lifecycle.
4. Follow the lifecycle in the plan: Fresh Ephemeral Lanes use a new short-id
   alias for one command-scoped job, while sticky/manual lanes reuse the base
   alias when it already exists and create it only when absent.
5. Omit `pane` on `herdr(action="pane_split")` to split the current
   agent/orchestrator pane. Pass `pane` only when the user asks for a source pane
   or a simultaneous lane must split from a worker pane to protect layout.
6. Stop/close Fresh Ephemeral Lanes only after the workflow success condition.
   On failure or timeout, read recent output, summarize, leave the lane open,
   and ask before cleanup. Sticky/manual lanes require explicit user cleanup.
7. Prefer sticky/manual lanes for servers and reviewer agents. Log tails default
   to ephemeral unless the user explicitly asks for persistent monitoring.

Common intents:

- Apex tests or anonymous Apex debugging → plan `run-tests` or `tail-logs`.
- Agent Script preview/eval → plan `preview` or `eval`, with Apex logs as a
  related signal when actions invoke Apex.
- Data 360 sweeps or async checks → plan `eval` for a sweep-style lane.
- Salesforce browser/UI fallback → plan `verify` or `tail-logs` around browser evidence.
- UI bundle work → plan `server` for dev server lanes and `run-tests` for test lanes.

### Keep context efficient

- Prefer structure/inspect/list tools over full file reads when available.
- Read reference files lazily, only for the workflow in front of you.
- Keep injected context stable so provider prompt caches can reuse it.
- Put broad examples in reference docs or skills, not in always-loaded kernel
  text.

### Keep public artifacts safe

When changing code, docs, prompts, tests, or examples intended for this public
repository, use generic examples only. Do not copy private Slack wording,
customer details, org identifiers, internal URLs, or user-specific local paths.

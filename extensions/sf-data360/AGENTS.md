# AGENTS.md — sf-data360

Agent rules for editing this extension. Repo-level rules still apply.

## Read first

1. `extensions/sf-data360/index.ts` — extension wiring and Manager-first command routing
2. `extensions/sf-data360/lib/v2/tools.ts` — public `data360_*` tool registration
3. `extensions/sf-data360/lib/v2/dispatcher.ts` — current action dispatch and execution
4. `extensions/sf-data360/lib/v2/action-registry.ts` — generated action-registry reader
5. `extensions/sf-data360/registry/v2/action-overrides.json` and
   `action-rules.json` — curated v2 action ownership and names
6. The matching focused Behavior Proof; open `references/README.md` only for
   task-specific reference depth.

## File map

| Responsibility                                            | File                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Extension entry, command, and tool registration           | `index.ts`                                                                                          |
| Public v2 family-tool schemas and registration            | `lib/v2/tools.ts`                                                                                   |
| V2 action routing, local helpers, journeys, and execution | `lib/v2/dispatcher.ts`, `lib/v2/`                                                                   |
| Runtime v2 action lookup                                  | `lib/v2/action-registry.ts`                                                                         |
| Curated v2 action ownership and naming                    | `registry/v2/action-overrides.json`, `registry/v2/action-rules.json`                                |
| Generated v2 action catalog                               | `registry/v2/actions.json`                                                                          |
| Method/path safety classification                         | `lib/safety.ts`                                                                                     |
| Facade-backed destructive execution gates                 | `lib/facade/destructive-guard.ts`                                                                   |
| Manager settings                                          | `lib/config-panel.ts`, `lib/settings.ts`                                                            |
| Shared connection, API version, auth, and timeouts        | `../../lib/common/sf-conn/`                                                                         |
| Progressive-disclosure guidance                           | `references/*.md`                                                                                   |
| Legacy facade and adapters                                | `lib/facade-tool.ts`, `lib/api-tool.ts`, `lib/metadata-tool.ts`, `lib/probe-tool.ts`, `lib/facade/` |

## Conventions

- Extend the public `data360_*` surface through the v2 tools, dispatcher, and
  action registry. Do not add public guidance for legacy `d360*` tools.
- Treat legacy infrastructure as compatibility-only for the public surface. It
  remains behind selected v2 adapters and focused compatibility tests, but it
  must not own public guidance or live-parity proof.
- Do not add upstream server/runtime support or hundreds of always-on
  endpoint-specific tools.
- Do not add extension-owned Agent Skills for Data 360. Put deeper guidance in
  `references/` and route agents through the `data360_*` tools.
- Use the public upstream Data 360 reference repository,
  <https://github.com/forcedotcom/d360-mcp-server>, for action-family and
  payload-shape questions before broad web search. Curate findings into
  Pi-native actions; do not copy upstream setup or authentication flows into
  SF Data 360 user docs.
- If mutating paths change, update `lib/safety.ts` and focused tests.
- Keep examples generic and public-safe; do not include real org aliases,
  instance URLs, customer data, private links, or secrets.

## Non-goals

- Full typed client generation for every Data 360 endpoint.
- Running or embedding the upstream Java server/runtime.
- Replacing official Salesforce documentation as the canonical source.

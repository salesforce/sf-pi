# AGENTS.md — sf-data360

Agent rules for editing this extension. Repo-level rules still apply.

## Read first

1. `extensions/sf-data360/README.md` — behavior and safety model
2. `extensions/sf-data360/index.ts` — extension wiring
3. `extensions/sf-data360/lib/facade-tool.ts` — `d360` search/examples/execute capability facade
4. `extensions/sf-data360/lib/api-tool.ts` — `d360_api` execution flow
5. `extensions/sf-data360/lib/metadata-tool.ts` — compact DMO/DLO discovery flow
6. `extensions/sf-data360/references/README.md` — reference-document index

## File map

| Responsibility                                              | File                                |
| ----------------------------------------------------------- | ----------------------------------- |
| Extension entry, command, and tool registration             | `index.ts`                          |
| Registry facade and deterministic runbooks                  | `lib/facade-tool.ts`, `lib/facade/` |
| Tool registration and raw `@salesforce/core` REST execution | `lib/api-tool.ts`                   |
| Compact DMO/DLO metadata list and describe helper           | `lib/metadata-tool.ts`              |
| Read-only Data 360 readiness probe                          | `lib/probe-tool.ts`                 |
| Read-only sf-pi manager settings panel                      | `lib/config-panel.ts`               |
| REST path and query-string normalization                    | `lib/path.ts`                       |
| Method/path safety classification                           | `lib/safety.ts`                     |
| Output truncation                                           | `lib/truncation.ts`                 |
| Progressive-disclosure guidance                             | `references/*.md`                   |
| Generated phase references                                  | `references/phases/*.md`            |

## Conventions

- Do not add upstream server/runtime support here.
- Do not add hundreds of always-on endpoint-specific tools. Prefer extending
  the `d360` registry facade with verified D360 capabilities.
- Do not add extension-owned Agent Skills for Data 360. Put guidance in
  `references/` files and rely on the `data360_*` tools for agent routing.
- Use the public upstream Data 360 reference repo,
  <https://github.com/forcedotcom/d360-mcp-server>, as the first external
  reference for action-family and payload-shape questions before broad web
  search. Curate findings into Pi-native `data360_*` actions; do not document
  upstream setup/auth flows in SF Data360 user docs.
- If new mutating paths are added, update `lib/safety.ts` and tests.
- Keep examples generic and public-safe; do not include real org aliases,
  instance URLs, customer data, internal links, or secrets.

## Non-goals

- Full typed client generation for every Data 360 endpoint.
- Running or embedding the upstream Java server/runtime.
- Replacing official Salesforce documentation as the canonical source.

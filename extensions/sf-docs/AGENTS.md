# AGENTS.md — sf-docs

Read `README.md` and `docs/cheatsheet.md` before changing behavior. SF Docs owns Salesforce documentation lookup inside SF Pi.

## File map

| Responsibility                                                   | File                           |
| ---------------------------------------------------------------- | ------------------------------ |
| Extension entry, provider auth, command routing, Manager actions | `index.ts`                     |
| Credential and endpoint resolution                               | `lib/auth.ts`                  |
| HTTP JSON-RPC/SSE transport                                      | `lib/client.ts`                |
| SSE data-line parsing                                            | `lib/sse.ts`                   |
| One `sf_docs` family tool                                        | `lib/sf_docs-tool.ts`          |
| Human and LLM-safe result formatting                             | `lib/render.ts`                |
| Non-secret scoped preferences                                    | `lib/preferences.ts`           |
| Manager settings panel                                           | `lib/config-panel.ts`          |
| Manager Connect / Disconnect action pages                        | `lib/manager-action-panels.ts` |
| Collection catalog cache                                         | `lib/catalog-cache.ts`         |
| Static collection coverage profiles                              | `lib/collection-profiles.ts`   |
| Developer reference routing                                      | `lib/developer-reference.ts`   |
| Release-note evidence classification                             | `lib/release-notes.ts`         |
| Command metadata/help                                            | `lib/command-surface.ts`       |
| Status summary                                                   | `lib/status.ts`                |
| Shared types/constants                                           | `lib/types.ts`                 |
| Lazy self-reference guide                                        | `docs/cheatsheet.md`           |

## Invariants

1. **One family tool.** Keep the public LLM surface as `sf_docs`; do not add one tool per remote action.
2. **No MCP runtime dependency.** Use the local HTTP JSON-RPC/SSE transport. Do not add MCP SDK, EventSource, scraping, search-index, or markdown parsing dependencies without a new ADR.
3. **Credential boundary.** Interactive SF Docs login uses `lib/common/secure-credential-prompt.ts`; Pi alone persists and removes API-key or OAuth-compatible credentials under provider id `sf-docs`. `SF_DOCS_MCP_TOKEN` remains the automation fallback. Never write the token to project settings, examples, tests, docs, session entries, or logs.
4. **Settings are non-secret.** `lib/config-panel.ts` reports only credential source and edits preferences. Connect may prepare `/login sf-docs` but never accepts token input itself.
5. **Cache catalog only.** `lib/catalog-cache.ts` stores collection metadata only. Do not cache search results, answers, fetched document bodies, prompts, or citations.
6. **Evidence workflow.** Prompt guidance should prefer `search` → `fetch` for implementation-sensitive work and reserve `answer` for quick cited synthesis.
7. **Human-polished, LLM-efficient.** Tool `content` stays compact; `details` carries structured sanitized metadata; `renderCall`/`renderResult` produce icon-rich, readable TUI output.
8. **Cheatsheet is lazy.** Do not inject `docs/cheatsheet.md` into always-on context or register it as a skill. Load it only through explicit command/tool action.
9. **Profiles are policy, not an index.** `lib/collection-profiles.ts` may describe collection coverage, URL traits, and routing guidance, but it must not become a local docs index or document-body cache.

## Testing

- Parser/client/auth/preference/cache changes need focused unit tests in `tests/`.
- Rendering changes should include snapshot-style assertions that visible citations/URLs remain present and tokens are absent.
- Do not add live-token tests to the default suite; live smoke should be opt-in via environment.

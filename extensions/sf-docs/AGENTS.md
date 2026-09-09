# AGENTS.md — sf-docs

SF Docs owns Salesforce documentation lookup inside SF Pi. Start from `index.ts`, the relevant implementation module, and its focused Behavior Proof; use `docs/README.md` only for task-specific reference depth.

## File map

| Responsibility                                                       | File                              |
| -------------------------------------------------------------------- | --------------------------------- |
| Extension entry, endpoint provider, command routing, Manager actions | `index.ts`                        |
| Pi-native endpoint login and resolution                              | `lib/auth.ts`                     |
| HTTP JSON-RPC/SSE transport                                          | `lib/client.ts`                   |
| Action payloads and response validation                              | `lib/protocol.ts`                 |
| Evidence completeness, bounds, and packets                           | `lib/evidence.ts`                 |
| Explicit deterministic grounding workflow                            | `lib/ground-workflow.ts`          |
| SSE data-line parsing                                                | `lib/sse.ts`                      |
| One `sf_docs` family tool                                            | `lib/sf_docs-tool.ts`             |
| Human and LLM-safe result formatting                                 | `lib/render.ts`                   |
| Non-secret scoped preferences                                        | `lib/preferences.ts`              |
| Manager settings panel                                               | `lib/config-panel.ts`             |
| Manager Connect / Disconnect action pages                            | `lib/manager-action-panels.ts`    |
| Collection catalog cache                                             | `lib/catalog-cache.ts`            |
| Collection query defaults and peer fallback                          | `lib/collection-retrieval.ts`     |
| Developer reference routing                                          | `lib/developer-reference.ts`      |
| Release-note evidence classification                                 | `lib/release-notes.ts`            |
| Command metadata/help                                                | `lib/command-surface.ts`          |
| Status summary                                                       | `lib/status.ts`                   |
| Compact DevBar footer pill                                           | `lib/footer-status.ts`            |
| Shared Welcome/DevBar status snapshot                                | `lib/common/docs-status/store.ts` |
| Shared types/constants                                               | `lib/types.ts`                    |
| Lazy self-reference guide                                            | `docs/cheatsheet.md`              |

## Invariants

1. **One family tool.** Keep the public LLM surface as `sf_docs`; do not add one tool per remote action.
2. **No MCP runtime dependency.** Use the local HTTP JSON-RPC/SSE transport. Do not add MCP SDK, EventSource, scraping, search-index, or markdown parsing dependencies without a new ADR.
3. **Endpoint boundary.** Interactive `/login sf-docs` collects only an internally supplied endpoint URL and Pi persists it as `credential.env.SF_DOCS_MCP_ENDPOINT` under provider id `sf-docs`. The service is unauthenticated: never request, store, or transmit an access token. `SF_DOCS_MCP_ENDPOINT` remains the automation fallback. Never ship a default docs hostname or expose the configured endpoint in model-visible status output.
4. **Settings are non-secret.** `lib/config-panel.ts` reports only endpoint configuration source and edits preferences. Connect may prepare `/login sf-docs` but never accepts endpoint input itself.
5. **Cache catalog only.** `lib/catalog-cache.ts` stores collection metadata scoped by a one-way endpoint identity. Do not persist the endpoint URL or cache search results, answers, fetched document bodies, prompts, or citations.
6. **Evidence workflow.** Prompt guidance should prefer explicit `ground` for implementation-sensitive work. Primitive search/fetch/answer/explain actions stay literal; reserve `answer` for quick cited synthesis.
7. **Human-polished, LLM-efficient.** Tool `content` stays compact; answer/explain text and citations are bounded; fetches report retrieval completeness separately from content truncation. `details` carries structured sanitized metadata; `renderCall`/`renderResult` produce icon-rich, readable TUI output.
8. **Cheatsheet is lazy.** Do not inject `docs/cheatsheet.md` into always-on context or register it as a skill. Load it only through explicit command/tool action.
9. **The service catalog is authoritative.** Derive collection descriptions, versions, locales, formats, hints, and landmarks from `list`; keep only narrow SF Pi-owned routing and evidence policy in code.

## Testing

- Parser/client/endpoint/preference/cache changes need focused unit tests in `tests/`.
- Rendering changes should include snapshot-style assertions that source citations/URLs remain visible while the configured service endpoint stays model-hidden.
- Live smoke should be opt-in and use only an explicitly configured endpoint.

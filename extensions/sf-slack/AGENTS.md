# AGENTS.md — sf-slack

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

## Read first

1. `extensions/sf-slack/README.md` — tool list, scope probing, formatting
2. `extensions/sf-slack/index.ts` — tool registration + event wiring
3. `extensions/sf-slack/lib/types.ts` — Slack payload shapes (the boundary)
4. The specific tool file you're editing (see map below)

## File map (what lives where)

Tools and their supporting modules follow a **one-file-per-concern** split:

| Tool / responsibility                | Tool file                            | Supporting lib                                      |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| `slack` (search, thread, history, …) | `lib/tools.ts`                       | `lib/api.ts`, `lib/search-plan.ts`, `lib/format.ts` |
| `slack_research`                     | `lib/research-tool.ts`               | `lib/search-plan.ts`, `lib/resolve.ts`              |
| `slack_resolve`                      | `lib/resolve-tool.ts`                | `lib/resolve.ts`                                    |
| `slack_time_range`                   | `lib/time-range-tool.ts`             | `lib/time-range.ts`                                 |
| `slack_channel`                      | `lib/channel-tool.ts`                | `lib/api.ts`                                        |
| `slack_user`                         | `lib/user-tool.ts`                   | `lib/api.ts`                                        |
| `slack_file`                         | `lib/file-tool.ts`                   | `lib/api.ts`                                        |
| `slack_canvas`                       | `lib/canvas-tool.ts`                 | `lib/api.ts`                                        |
| `slack_send`                         | `lib/send-tool.ts`                   | `lib/api.ts`, `lib/recipient-confirm.ts`            |
| Shared HITL recipient confirmation   | `lib/recipient-confirm.ts`           | `lib/resolve.ts`                                    |
| Auth + token cache                   | `lib/auth.ts`                        | —                                                   |
| Runtime scope probing                | `lib/scope-probe.ts`                 | —                                                   |
| Raw Slack API payload shapes         | `lib/types.ts`                       | —                                                   |
| Shared HTTP + JSON parsing           | `lib/api.ts`                         | —                                                   |
| Message / thread / canvas rendering  | `lib/render.ts`, `lib/format.ts`     | —                                                   |
| Truncation policy                    | `lib/truncation.ts`                  | —                                                   |
| Emoji / reaction name normalization  | `lib/emoji.ts`                       | —                                                   |
| Config panel                         | `lib/config-panel.ts`                | `lib/settings-panel.ts`                             |
| Preferences / per-tool stats         | `lib/preferences.ts`, `lib/stats.ts` | —                                                   |

## Conventions

1. **Type the boundary once.** Raw Slack payloads belong in `lib/types.ts`.
   Keep tool handlers and formatters working on named interfaces, not `any`.
2. **Pure formatters.** `lib/format.ts` and `lib/render.ts` take typed
   inputs and produce strings. No network, no mutation.
3. **HTTP goes through `lib/api.ts`.** Don't open new `fetch` call sites
   in tool files — add a typed helper to `api.ts` and call it.
4. **Respect missing-scope paths.** If a Slack endpoint needs a scope the
   token may not have, add an explicit fallback + user-facing notice
   rather than throwing.
5. **Stay width-safe.** Rendered output uses `visibleWidth` + truncation
   helpers (see `lib/render.ts`). Don't use raw `.length` on strings with
   ANSI or emoji.

## Testing

- New formatter / helper → unit test in `tests/` with a matching name.
- Changes to rendering → update `tests/render-snapshot.test.ts`.
- Changes to search plan / strict→broad fallback → update
  `tests/search-plan.test.ts`.

## Non-goals

- This extension has **two** write surfaces: `slack_canvas` (create/edit)
  and `slack_send` (post messages). Every `slack_send` call goes through
  an explicit `ctx.ui.confirm()` dialog in interactive mode, and is
  refused in non-interactive mode unless `SLACK_ALLOW_HEADLESS_SEND=1`.
- No reactions, edits or deletes of existing messages, scheduled messages,
  ephemeral messages, block kit, attachments, or file uploads. Each of
  those is a different confirmation-UX conversation and belongs in its
  own proposal.
- Do not add tools that require additional Slack scopes without
  surfacing them in the scope-probe output and setup overlay.
- Do not add alternate send paths that skip the confirm dialog. The
  dialog is the product, not the implementation.

## Human-in-the-loop recipient resolution (P-HITL)

Every tool that turns a fuzzy channel or user reference into an ID must
route through `requireConfirmedChannel` / `requireConfirmedUser` in
`lib/recipient-confirm.ts`. This is the single source of truth for:

- the 0.85 auto-confirm threshold (unified across reads and writes),
- the interactive select-or-type dialog for low-confidence refs,
- the 'Type exact name/ID instead' escape hatch (infinite retry loop),
- headless-mode loud-failure with the candidate list in the error.

Do not reintroduce ad-hoc `resolveChannelParam` / `resolveUserParam`
helpers in new tool files; delegate to the shared helper. The
`resolveChannel` / `resolveUser` primitives in `lib/resolve.ts` are
intentionally one layer below — they perform the lookups, the helper
adds the HITL dialog.

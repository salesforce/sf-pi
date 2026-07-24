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
| `slack_schedule`                     | `lib/schedule-tool.ts`               | `lib/api.ts`                                        |
| Shared HITL recipient confirmation   | `lib/recipient-confirm.ts`           | `lib/resolve.ts`                                    |
| Auth + token cache                   | `lib/auth.ts`                        | —                                                   |
| Runtime scope probing                | `lib/scope-probe.ts`                 | —                                                   |
| Raw Slack API payload shapes         | `lib/types.ts`                       | —                                                   |
| Shared HTTP + JSON parsing           | `lib/api.ts`                         | —                                                   |
| Message / thread / canvas rendering  | `lib/render.ts`, `lib/format.ts`     | —                                                   |
| Footer + status report formatting    | `lib/status.ts`                      | —                                                   |
| Truncation policy                    | `lib/truncation.ts`                  | —                                                   |
| Emoji / reaction name normalization  | `lib/emoji.ts`                       | —                                                   |
| Manager settings panel               | `lib/config-panel.ts`                | `lib/preferences.ts`                                |
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
6. **Credential boundary.** Interactive login uses
   `lib/common/secure-credential-prompt.ts`; Pi alone persists/removes API-key
   or OAuth-compatible credentials. `SLACK_USER_TOKEN` remains the automation
   fallback. Never accept or display tokens in Slack panels or tool output.

## Testing

- New formatter / helper → unit test in `tests/` with a matching name.
- Changes to rendering → update `tests/render-snapshot.test.ts`.
- Changes to search plan / strict→broad fallback → update
  `tests/search-plan.test.ts`.

## Non-goals

- This extension has **three** write surfaces: `slack_canvas` (create/edit),
  `slack_send` (post messages), and `slack_schedule` (schedule/delete pending
  API-scheduled messages). Every `slack_send` call and every `slack_schedule`
  schedule/delete call goes through an explicit `ctx.ui.confirm()` dialog in
  interactive mode, and is refused in non-interactive mode unless
  `SLACK_ALLOW_HEADLESS_SEND=1`.
- `slack_schedule` must stay on Slack's supported public Web API endpoints
  (`chat.scheduleMessage`, `chat.scheduledMessages.list`,
  `chat.deleteScheduledMessage`). Do not silently switch it to Slack's
  internal drafts APIs; those require a separate auth/security proposal.
- No reactions, edits or deletes of existing posted messages, ephemeral
  messages, block kit, attachments, or file uploads. Each of those is a
  different confirmation-UX conversation and belongs in its own proposal.
- Do not add tools that require additional Slack scopes without
  surfacing them in the scope-probe output and setup overlay.
- Do not add alternate send paths that skip the confirm dialog. The
  dialog is the product, not the implementation.

## Human-in-the-loop recipient resolution (P-HITL)

Every read-style tool that turns a fuzzy channel or user reference into an ID must
route through `requireConfirmedChannel` / `requireConfirmedUser` in
`lib/recipient-confirm.ts`. `slack_send` is the exception: it resolves candidates
itself and folds recipient confidence/alternates into the final send confirmation
so normal sends do not show two separate dialogs. The shared helper remains the
single source of truth for:

- the 0.85 auto-confirm threshold (unified across reads and writes),
- the interactive select-or-type dialog for low-confidence refs,
- the 'Type exact name/ID instead' escape hatch (infinite retry loop),
- headless-mode loud-failure with the candidate list in the error.

Do not reintroduce ad-hoc `resolveChannelParam` / `resolveUserParam`
helpers in new read tool files; delegate to the shared helper. For
`slack_send`, keep recipient review inside the single final confirmation rather
than adding a separate select dialog. The `resolveChannel` / `resolveUser`
primitives in `lib/resolve.ts` are intentionally one layer below — they perform
the lookups, while the caller adds the appropriate HITL surface.

# SF Slack — Code Walkthrough

## What It Does

Full Slack integration for pi — search messages, read threads, browse channel
history, look up channels/users/files, read/create/edit canvases, post
messages with human-in-the-loop confirmation, and manage API-scheduled messages. Includes runtime scope probing
and agent context injection.

The extension registers 10 tools, an auth provider, a status command,
scope probing on session start, and system prompt context injection.

`slack_send` and `slack_schedule` are the write-to-humans surfaces in
sf-slack: posting, scheduling, and deleting scheduled messages confirm with
the user via `ctx.ui.confirm()` before mutating Slack.

## Type-Safety Best Practices Used

This extension now follows the same broad style used in the clearer parts of
this repo such as the shared Salesforce environment runtime and `sf-lsp`:

1. **Type the boundary once** — raw Slack API payload shapes live in `lib/types.ts`.
2. **Use typed endpoint helpers** — `api.ts` parses JSON once and returns typed results.
3. **Keep formatters pure** — `format.ts` works on named interfaces, not loose bags of data.
4. **Keep tool fallbacks explicit** — missing-scope paths stay readable and local.
5. **Avoid `any` in implementation code** — prefer named interfaces and small helper functions.

## Runtime Flow

```
Extension loads
  ├─ registerProvider("sf-slack")           ← existing credential resolution + refresh
  ├─ registerCommand("sf-slack")            ← status / refresh / help
  │
  │  Note: no Slack tools are registered at load.
  │  Registration is gated on token availability to keep the
  │  system prompt Slack-free when sf-slack is not configured.
  │
  └─ on("session_start")
       ├─ Resolve token (pi auth → SLACK_USER_TOKEN env)
       ├─ If no token → keep footer hidden, DO NOT register tools
       └─ If token found:
            ├─ ensureSlackToolsRegistered()  ← registers 9 slack* tools
            ├─ auth.test → validate token, detect identity, capture
            │              X-OAuth-Scopes
            ├─ gateToolsFromGrantedScopes() → disable tools whose scopes Slack
            │                                did not grant, using the header
            │                                captured from auth.test
            ├─ Set footer "Slack: ✓ Connected" with scope-grant coverage
            │  (scope coverage is separate from auth/connectivity)
            └─ fire-and-forget cache prewarm:
               ├─ users.list → pre-warm user cache
               └─ conversations.list → pre-warm channel cache

            Only auth.test + local scope gating are awaited so turn-1 already
            ships the final gated tool set. Cache prewarm is display-quality
            only; raw IDs remain valid fallbacks until it finishes.
  on("session_shutdown")
       └─ Clear footer status
  on("before_agent_start")
       ├─ If no Slack tool is active in systemPromptOptions.selectedTools → skip
       └─ Inject <slack_workspace> identity anchors (User + Team) only
            (cache sizes and gated counts are intentionally omitted — they drift
             turn-to-turn and would invalidate prompt cache)
  /sf-slack
       ├─ UI available + no args → open SF Slack in the SF Pi Manager
       ├─ Manager Connect        → prefill native /login with fixed-mask entry
       ├─ Manager Disconnect     → prefill native /logout for review
       └─ no UI + no args        → show auth status
  /sf-slack refresh
       ├─ If a token resolves now but tools were not registered earlier → ensureSlackToolsRegistered()
       └─ Re-probe scopes, re-warm caches
```

## Connecting

The `/sf-slack` **Connect** action prepares `/login sf-slack`. Interactive
entry uses SF Pi's shared fixed-mask component; Pi alone persists and removes
the resulting API-key or OAuth-compatible credential. After login, run
`/sf-slack refresh` to verify identity, scopes, and tool availability.

Existing credentials in Pi's auth store remain compatible. For automation, set
the non-persisted environment fallback before starting Pi:

```bash
export SLACK_USER_TOKEN=xoxp-...
pi
```

| Source                      | Current behavior                                               |
| --------------------------- | -------------------------------------------------------------- |
| Existing Pi auth credential | API-key and OAuth-compatible shapes continue to resolve        |
| `SLACK_USER_TOKEN`          | Non-persisted automation and CI fallback                       |
| Interactive Connect / login | Fixed-mask TUI entry; Pi owns persistence and native `/logout` |

If both usable sources are present, the existing Pi credential wins. The
**Disconnect** action prefills `/logout sf-slack` for review and never modifies
`SLACK_USER_TOKEN`.

## Obtaining an `xoxp-` User Token

> Warning
>
> This requires a Slack app that is approved in the target workspace and a user
> account that is allowed to install or authorize that app. Some workspaces
> restrict app installs or specific scopes.

If your organization already provides an approved OAuth helper page, use that
flow and export the returned token as `SLACK_USER_TOKEN` before starting Pi.
Do not paste the token or callback URL into SF Pi while containment is active.

If you need to build or verify the flow yourself, use Slack OAuth v2 with the
requested user-token scopes in the `user_scope` parameter:

```text
https://slack.com/oauth/v2/authorize
```

A minimal authorization URL looks like this:

```text
https://slack.com/oauth/v2/authorize?client_id=YOUR_CLIENT_ID&user_scope=search:read.public,search:read.files,users:read,channels:history&redirect_uri=https://YOUR-APP.example.com/slack/callback
```

High-level flow:

1. Create or reuse an approved Slack app.
2. Add the user scopes you need under **OAuth & Permissions**.
3. Configure an HTTPS redirect URL.
4. Send the user through the OAuth consent screen.
5. Exchange the returned `code` using `oauth.v2.access` and store the returned `authed_user.access_token`.
6. Store the resulting `xoxp-...` token securely.

Example code exchange:

```bash
curl -X POST https://slack.com/api/oauth.v2.access \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=YOUR_CLIENT_ID' \
  --data-urlencode 'client_secret=YOUR_CLIENT_SECRET' \
  --data-urlencode 'code=RETURNED_CODE' \
  --data-urlencode 'redirect_uri=https://YOUR-APP.example.com/slack/callback'
```

Notes:

- For user-token-only and MCP-style flows, put scopes in `user_scope` and omit
  bot-only scopes from that parameter.
- If your org provides a helper page, that page may perform the code exchange
  for you and simply show the token or a ready-to-copy MCP configuration.
- Never commit tokens to the repo or paste them into checked-in config files.

## Scope Planning

Slack scopes are additive. Re-running OAuth with new scopes adds permissions to
an existing token; it does not remove old ones. To reduce scopes, revoke the
existing token and re-authorize.

Slack also supports optional scopes. For broad integrations, use required scopes
for core features and mark invasive scopes as optional when possible.

### Recommended scope bundles

`sf-slack` is designed to work with partial grants. A token with fewer scopes is
not automatically broken; `/sf-slack` renders the Slack-approved scope grant plus
a capability summary so users can see what is available and what is degraded.

| Profile               | Scopes                                                             | Notes                                                                                 |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Public search         | `search:read.public`, `search:read.files`, `search:read.users`     | Search public channels, files, and users                                              |
| Private and DM search | `search:read.private`, `search:read.im`, `search:read.mpim`        | User-token-only scopes; admins may choose not to grant them                           |
| Message context       | `channels:history`, `groups:history`, `im:history`, `mpim:history` | Needed for `conversations.history` / `conversations.replies`                          |
| Directory metadata    | `channels:read`, `groups:read`, `im:read`, `mpim:read`             | Enables channel info/list/member APIs; search fallbacks exist                         |
| User lookup           | `users:read`, `users:read.email`                                   | Email lookup requires `users:read.email`                                              |
| File metadata         | `files:read`                                                       | Separate from `search:read.files`; needed for `files.info`                            |
| Canvas sections       | `canvases:read`                                                    | Enables `canvases.sections.lookup` and section ID discovery                           |
| Canvas create/edit    | `canvases:write`                                                   | Needs a user token (`xoxp-`)                                                          |
| Posting messages      | `chat:write`, `im:write`, `mpim:write`                             | `chat:write` posts as the user to known channels/DM IDs; `im:write` opens new 1:1 DMs |

### Capability-oriented profiles

| Profile          | Suggested scopes                                                                                                           | Best for                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Minimal read     | `search:read.public`, `search:read.users`, `channels:history`, `users:read`                                                | Public search and basic message context    |
| Private research | Minimal read + `search:read.private`, `search:read.im`, `search:read.mpim`, `groups:history`, `im:history`, `mpim:history` | Searching private channels, DMs, and MPDMs |
| Canvas work      | Private research + `canvases:read`, `canvases:write`; add `files:read` for metadata                                        | Canvas section lookup, creation, and edits |
| Posting          | Canvas work + `chat:write`; add `im:write` / `mpim:write` to open new DMs/MPDMs                                            | Human-confirmed `slack_send` workflows     |
| Maximum coverage | Everything in `DEFAULT_SCOPES`                                                                                             | Broadest local development and diagnostics |

### Maximum coverage for this extension

If your goal is broad `sf-slack` coverage, including private channels, DMs,
MPDMs, file lookups, user email lookup, canvases, and optional posting, request:

```text
search:read.public,search:read.files,search:read.users,
search:read.private,search:read.im,search:read.mpim,
channels:history,groups:history,im:history,mpim:history,
channels:read,groups:read,im:read,mpim:read,
users:read,users:read.email,files:read,
canvases:read,canvases:write,
chat:write,im:write,mpim:write
```

Omit the `chat:write` / `im:write` / `mpim:write` scopes if you do not want message
posting. `slack_send` and `slack_schedule` remain gated and confirmed even when those scopes exist.
`chat:write.public` is intentionally not part of the user-token scope bundle; it
is a bot/app public-channel posting enhancer and does not replace user-token
`chat:write` for this extension.

### Scope caveats

- `search:read.files` lets you search for files, but `files:read` is still
  needed if you want file metadata, file listing, or downloads.
- `canvases:read` lets `slack_canvas read` find section IDs with
  `canvases.sections.lookup`; it does not provide full file metadata.
- `canvases:write` lets `slack_canvas create/edit` write canvases, but targeted
  operations such as `replace` or `insert_before` still need a section ID. Use
  `canvases:read` to discover section IDs when you do not already have them.
- Private, DM, and MPDM search scopes require user consent and are more
  sensitive than public search scopes.
- Slack's Real-time Search and MCP features are limited to internal apps or
  directory-published apps.
- Published apps may hit `unapproved_scope` during rollout if newly requested
  scopes have not been approved yet.
- Slack docs recommend using granular `search:read.*` scopes for AI/search
  workflows instead of relying on the legacy `search:read` scope.

## Tools

### 1. `slack_time_range` — Deterministic time boundaries

Use this before Slack history/search calls when the user gives a human date
range such as `last week`, `yesterday`, `last 7 days`, `last month`, or
`2026-04-13 to 2026-04-20`. The tool returns exact `oldest` / `latest`
timestamps for `conversations.history` plus date operators for Slack search.

| Parameter        | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `expression`     | Human time range to resolve                                                            |
| `timezone`       | Optional IANA timezone, e.g. `UTC` or `America/Los_Angeles`                            |
| `week_starts_on` | `monday` or `sunday`; defaults to `monday`                                             |
| `anchor`         | Optional ISO date/time used as “now” for deterministic evaluation                      |
| `calendar_mode`  | `calendar` for previous/current calendar periods, or `rolling` for a rolling window    |
| `explicit_end`   | For explicit date ranges, whether the end date is `exclusive` (default) or `inclusive` |

Example output for `last week` includes:

```text
oldest: "1776038400.000000"
latest: "1776643200.000000"
after:2026-04-13 before:2026-04-20
```

### 2. `slack` — Messages (core read-only)

| Action      | Parameters                                                        | API                                            | Description                        |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `search`    | `query`, `limit`                                                  | `assistant.search.context` → `search.messages` | Find messages by keyword           |
| `thread`    | `channel`, `ts`, `limit`, `cursor`, `resolve_users`               | `conversations.replies`                        | Fetch thread replies               |
| `history`   | `channel`, `oldest`, `latest`, `limit`, `cursor`, `resolve_users` | `conversations.history`                        | Browse channel messages            |
| `permalink` | `channel`, `ts`                                                   | `chat.getPermalink`                            | Get a durable message URL          |
| `auth`      | (none)                                                            | local                                          | Check auth status and token source |

### 3. `slack_resolve` — Entity resolution

| Parameter | Description                                                                                  |
| --------- | -------------------------------------------------------------------------------------------- |
| `type`    | `channel` or `user`                                                                          |
| `text`    | Fuzzy human reference, e.g. `#team-lab`, `team lab`, `me`, `Jane Doe`, or `jane@example.com` |
| `limit`   | Maximum candidates to return                                                                 |
| `clarify` | In interactive mode, ask the user to choose when confidence is low                           |

`slack_resolve` uses cache lookup, direct ID validation, Slack list APIs, search-context fallback, and fuzzy ranking. It returns the best candidate plus alternates with confidence scores.

### 4. `slack_research` — Agentic Slack search

`slack_research` turns structured research intent into Slack search syntax, executes strict-to-broad fallback queries, dedupes results, and can fetch thread context. If a `channel_ref` is provided but cannot be resolved confidently, it asks for clarification in interactive mode or returns candidates; it does not silently broaden to a workspace-wide search.

Key parameters:

| Parameter                   | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `query`                     | Natural-language topic or terms                                                        |
| `channel_ref`               | Optional fuzzy channel reference; compiles to `in:#channel` after resolution           |
| `from_ref`                  | Optional author reference; `me` compiles to `from:me`, people compile to `from:handle` |
| `with_ref`                  | Optional participant reference; compiles to `with:@Display Name`                       |
| `since`, `before`, `during` | Timeline operators such as `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, or `during:week`   |
| `content_filters`           | Compiles to `has:link`, `has:file`, `has:pin`, or `has:reaction`                       |
| `reaction_names`            | Compiles to `has::emoji:` filters                                                      |
| `thread_only`               | Adds `is:thread`                                                                       |
| `include_threads`           | Fetches replies for matching threaded results                                          |

### 5. `slack_channel` — Channels

| Action    | Parameters                                    | API                     | Description                            |
| --------- | --------------------------------------------- | ----------------------- | -------------------------------------- |
| `info`    | `channel`                                     | `conversations.info`    | Channel metadata (with scope fallback) |
| `list`    | `name_filter`, `types`, `limit`, `cursor`     | `conversations.list`    | Find channels (with search fallback)   |
| `members` | `channel`, `limit`, `cursor`, `resolve_users` | `conversations.members` | List members (with history fallback)   |

### 6. `slack_user` — Users

| Action     | Parameters                       | API                   | Description                |
| ---------- | -------------------------------- | --------------------- | -------------------------- |
| `info`     | `user`                           | `users.info`          | Resolve user ID to profile |
| `email`    | `email`                          | `users.lookupByEmail` | Resolve email to profile   |
| `presence` | `user`                           | `users.getPresence`   | Check online/away status   |
| `list`     | `name_filter`, `limit`, `cursor` | `users.list`          | Browse org directory       |

### 7. `slack_file` — Files

| Action | Parameters                                    | API          | Description             |
| ------ | --------------------------------------------- | ------------ | ----------------------- |
| `info` | `file`                                        | `files.info` | File metadata by ID     |
| `list` | `channel`, `user`, `types`, `limit`, `cursor` | `files.list` | List files with filters |

### 8. `slack_canvas` — Canvases (read + write)

| Action   | Parameters                                         | API                                       | Description                    |
| -------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `read`   | `canvas_id`, `criteria`                            | `files.info` / `canvases.sections.lookup` | Canvas metadata or section IDs |
| `create` | `title`, `markdown`, `channel_id`                  | `canvases.create`                         | Create a new canvas            |
| `edit`   | `canvas_id`, `operation`, `markdown`, `section_id` | `canvases.edit`                           | Modify an existing canvas      |

Canvas reads degrade by scope:

- With `files:read`, `read` without `criteria` returns canvas file metadata.
- With `canvases:read`, `read` with `criteria` returns matching section IDs.
- Without `files:read` but with `canvases:read`, metadata reads fall back to
  header section lookup and return section IDs for follow-up edits.
- `criteria.contains` is the friendly tool field; the wrapper sends Slack's
  required `criteria.contains_text` wire field.
- Valid `criteria.section_types` values are `h1`, `h2`, `h3`, and
  `any_header`. Invalid values are rejected locally before calling Slack.

### 9. `slack_send` — Post messages (human-in-the-loop write)

The only surface that posts arbitrary text as the authenticated user. Every
call confirms with the user via `ctx.ui.confirm()` in interactive mode.
Non-interactive modes (`pi -p`, RPC) **refuse** unless the user has explicitly
opted in with `SLACK_ALLOW_HEADLESS_SEND=1`.

| Action    | Parameters                              | API                                       | Description                     |
| --------- | --------------------------------------- | ----------------------------------------- | ------------------------------- |
| `channel` | `to`, `text`, `broadcast?`              | `chat.postMessage`                        | Post to a channel or MPIM       |
| `dm`      | `to`, `text`                            | `conversations.open` → `chat.postMessage` | Open (or reuse) 1:1 IM and post |
| `thread`  | `to`, `thread_ts`, `text`, `broadcast?` | `chat.postMessage` with `thread_ts`       | Reply in an existing thread     |

Safety rails (enforced in `lib/send-tool.ts`):

- **Token gate** — rejects bot/app tokens upfront; `slack_send` is user-token only.
- **Scope gate** — requires user-token `chat:write`. `action=dm`
  uses `im:write` to open a DM when available; without it, the tool searches
  for an already-open `D...` DM channel and posts there after confirmation.
- **Unified recipient + send HITL** — `slack_send` resolves fuzzy `to` values
  before the final confirmation dialog and shows the selected recipient,
  confidence, and alternates inline with the message preview. It does not open
  a separate recipient-selection dialog for normal sends; headless mode still
  fails loudly when the match is below threshold.
- **Broadcast re-confirm** — `@channel`, `@here`, `@everyone`, and
  `<!subteam ...>` user-group pings flip the confirm dialog's default to
  Cancel.
- **Dry-run** — `SLACK_SEND_DRY_RUN=1` runs the full confirm UX and audit
  entry without calling Slack.
- **Audit trail** — every send (including dry-runs and cancellations) is
  appended to the session via `pi.appendEntry(SEND_ENTRY_TYPE, ...)`. View
  with `/sf-slack sent`.

Never returns raw tokens or credentials in its output.

### 10. `slack_schedule` — Scheduled messages (human-in-the-loop write)

Uses Slack's supported public Web API scheduled-message endpoints. Messages
queued by `chat.scheduleMessage` are fully functional: they post at the
requested time and are visible programmatically through
`chat.scheduledMessages.list`. They are API queue items rather than Slack client
scheduled drafts, so they do not show in Slack's client-side **Drafts & sent →
Scheduled** tab. Using Slack's internal draft APIs is intentionally out of scope
for this supported implementation.

| Action     | Parameters                                                           | API                           | Description                         |
| ---------- | -------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| `schedule` | `channel_id`, `message`, `post_at`, `thread_ts?`, `reply_broadcast?` | `chat.scheduleMessage`        | Queue a future message              |
| `list`     | `channel_id?`, `oldest?`, `latest?`, `limit?`, `cursor?`             | `chat.scheduledMessages.list` | List pending API-scheduled messages |
| `delete`   | `channel_id`, `scheduled_message_id`                                 | `chat.deleteScheduledMessage` | Cancel a pending scheduled message  |

Safety rails mirror `slack_send`:

- Requires a user token with `chat:write`; no extra Slack scope is needed for
  scheduling.
- `schedule` and `delete` show an explicit confirmation dialog in interactive
  mode.
- Non-interactive modes refuse writes unless `SLACK_ALLOW_HEADLESS_SEND=1`.
- `SLACK_SEND_DRY_RUN=1` rehearses `schedule` without calling Slack.
- Schedule times are validated locally: at least 2 minutes in the future and no
  more than 120 days out.
- Slack's `restricted_too_many` error is surfaced when a channel already has too
  many messages scheduled for the same 5-minute window.

## Scope Probing & Tool Gating

On `session_start`, the extension makes a lightweight `auth.test` call and reads
Slack's `X-OAuth-Scopes` response header. That header is the source of truth for
what the workspace actually granted, which may be less than what `DEFAULT_SCOPES`
requested. Tools whose required capability groups are missing are dynamically
removed from the active tool set, keeping the LLM system prompt clean.

| Tool / capability      | Enabled when the token has any of...                                             | Degraded behavior when partial                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `slack` search/history | `search:read`, granular `search:read.*`, `channels:history`, or `groups:history` | Search and history actions fail per-action with scope-specific guidance                                   |
| `slack_research`       | `search:read` or granular message search scopes                                  | Thread expansion may still require history scopes                                                         |
| `slack_channel`        | `channels:read`, `groups:read`, `im:read`, or `mpim:read`                        | Channel info/list/member calls use search/history fallbacks where possible                                |
| `slack_user`           | `users:read`                                                                     | Some resolver paths can still mine users from search results                                              |
| `slack_file`           | `files:read`                                                                     | File search may still work through `slack` when `search:read.files` exists                                |
| `slack_canvas`         | `canvases:read` or `files:read`                                                  | Metadata and section lookup degrade independently by action                                               |
| `slack_send`           | user token + `chat:write`                                                        | DMs can reuse an existing `D...` channel; opening a new DM still needs `im:write`; all sends require HITL |
| `slack_schedule`       | user token + `chat:write`                                                        | Uses public chat.\* scheduled-message APIs; listable programmatically, not shown in Slack Scheduled UI    |

`/sf-slack` renders both the raw granted/requested scope diff and a capability
summary such as Search, History, Files, Canvases, and Posting. This keeps a
partial scope grant understandable instead of making it look like a broken
login.

## Agent Context Injection

On every `before_agent_start`, when at least one `slack*` tool is active the
extension injects the minimum Slack context the LLM needs to interpret
`from:me` / `with:@user` references correctly:

```
<slack_workspace>
User: @username (U01ABC123)
Team: T01XYZ789
</slack_workspace>
```

Cache sizes and gated-tool counts are intentionally **not** included because
they drift turn-to-turn and would invalidate prompt cache on every call.
Those metrics live in the footer and the research-activity widget instead.

The injected block is NOT displayed to the user (`display: false`) — only
visible to the LLM.

## Commands

| Command                | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `/sf-slack`            | Open SF Slack in the SF Pi Manager; show auth status in no-UI mode |
| `/sf-slack connect`    | Show temporary safe credential-setup guidance                      |
| `/sf-slack disconnect` | Prefill native logout for review; environment is untouched         |
| `/sf-slack status`     | Show auth status and connection info                               |
| `/sf-slack refresh`    | Re-detect identity, re-probe scopes, refresh cache                 |
| `/sf-slack settings`   | Open Manager Settings for search detail, widget, and permalinks    |
| `/sf-slack sent`       | List `slack_send` activity in the current branch                   |
| `/sf-slack help`       | Show command help                                                  |

## Preferences

Slack rendering preferences live in Pi settings under `sfPi.slack` and are edited from **SF Pi Manager → SF Slack → Settings** or via `/sf-slack settings` in an interactive session. Project settings override global settings. Legacy `sf-slack-prefs` session entries are read only as a fallback when no Pi setting exists.

## Display Profile Integration

When the Slack search-detail preference is `auto` (the default), `sf-slack`
follows the shared `/sf-pi display` profile:

| Display profile | Slack default fields |
| --------------- | -------------------- |
| `compact`       | `summary`            |
| `balanced`      | `preview`            |
| `verbose`       | `full`               |

Explicit tool arguments still win. For example, `fields: "full"` always
returns full bodies regardless of the shared display profile.

## Behavior Matrix

| Event/Trigger        | Condition                       | Result                                                                         |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `session_start`      | token available                 | Register slack\* tools, detect identity, probe scopes, cache users, set footer |
| `session_start`      | no token                        | Skip tool registration entirely, keep footer hidden                            |
| `session_shutdown`   | —                               | Clear footer status                                                            |
| `before_agent_start` | identity + at least one slack\* | Inject minimal workspace context (User + Team only)                            |
| `before_agent_start` | no identity / no slack tools    | Skip injection                                                                 |
| `/sf-slack`          | UI available                    | Open SF Slack in the SF Pi Manager                                             |
| `/sf-slack`          | no UI                           | Show auth status                                                               |
| `/sf-slack refresh`  | token resolves now              | Register tools if needed, re-probe scopes, refresh cache                       |
| any tool call        | no auth                         | Return setup instructions (defensive; normally unreachable)                    |

## Environment Variables

| Variable                    | Required | Description                                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `SLACK_USER_TOKEN`          | Optional | Slack user OAuth token (xoxp-...) for automation                                                                   |
| `SLACK_TEAM_ID`             | Optional | Workspace or enterprise grid team ID                                                                               |
| `SLACK_CLIENT_ID`           | Optional | OAuth app client ID (enables OAuth flow)                                                                           |
| `SLACK_CLIENT_SECRET`       | Optional | OAuth app client secret                                                                                            |
| `SLACK_REDIRECT_URI`        | Optional | OAuth redirect URI                                                                                                 |
| `SLACK_SCOPES`              | Optional | Override default scope list                                                                                        |
| `SLACK_ALLOW_HEADLESS_SEND` | Optional | `1` allows `slack_send` in non-interactive mode (`pi -p`, RPC). Default refuses.                                   |
| `SLACK_SEND_DRY_RUN`        | Optional | `1` runs the full `slack_send` / `slack_schedule schedule` confirm UX + audit entry without calling the Slack API. |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-slack/
  lib/
    api.ts                  ← implementation module
    auth.ts                 ← implementation module
    canvas-tool.ts          ← implementation module
    capabilities.ts         ← implementation module
    channel-tool.ts         ← implementation module
    config-panel.ts         ← implementation module
    emoji.ts                ← implementation module
    extension-doctor.ts     ← implementation module
    file-tool.ts            ← implementation module
    format.ts               ← implementation module
    manager-action-panels.ts← implementation module
    preferences-panel.ts    ← implementation module
    preferences.ts          ← implementation module
    recipient-confirm.ts    ← implementation module
    render.ts               ← implementation module
    research-tool.ts        ← implementation module
    resolve-tool.ts         ← implementation module
    resolve.ts              ← implementation module
    runtime-cache.ts        ← implementation module
    schedule-tool.ts        ← implementation module
    scope-probe.ts          ← implementation module
    search-plan.ts          ← implementation module
    send-tool-recipient.ts  ← implementation module
    send-tool.ts            ← implementation module
    stats.ts                ← implementation module
    status.ts               ← implementation module
    time-range-tool.ts      ← implementation module
    time-range.ts           ← implementation module
    tools.ts                ← implementation module
    truncation.ts           ← implementation module
    types.ts                ← implementation module
    user-tool.ts            ← implementation module
  tests/
    api.test.ts             ← unit / smoke test
    auth-status.test.ts     ← unit / smoke test
    auth.test.ts            ← unit / smoke test
    canvas-preflight.test.ts← unit / smoke test
    channel-cache-from-search.test.ts← unit / smoke test
    channel-types-default.test.ts← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    credential-security.test.ts← unit / smoke test
    emoji.test.ts           ← unit / smoke test
    extra-format.test.ts    ← unit / smoke test
    field-modes.test.ts     ← unit / smoke test
    format.test.ts          ← unit / smoke test
    preferences-stats.test.ts← unit / smoke test
    prompt-surface.test.ts  ← unit / smoke test
    recipient-confirm.test.ts← unit / smoke test
    registration-gate.test.ts← unit / smoke test
    render-helpers.test.ts  ← unit / smoke test
    render-snapshot.test.ts ← unit / smoke test
    resolve-tool-clarify-gate.test.ts← unit / smoke test
    resolve.test.ts         ← unit / smoke test
    runtime-cache.test.ts   ← unit / smoke test
    schedule-tool.test.ts   ← unit / smoke test
    scope-probe.test.ts     ← unit / smoke test
    search-plan.test.ts     ← unit / smoke test
    send-tool.test.ts       ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    status.test.ts          ← unit / smoke test
    system-prompt-options.test.ts← unit / smoke test
    time-range.test.ts      ← unit / smoke test
    tools.test.ts           ← unit / smoke test
    truncation.test.ts      ← unit / smoke test
    user-cache-from-search.test.ts← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

All formatters and helpers are pure functions — no network calls in tests:

- `smoke.test.ts` — module export check
- `auth.test.ts` — token masking, expiry formatting
- `format.test.ts` — search results, messages, structured data extraction
- `field-modes.test.ts` — summary/preview/full body trimming contract
- `extra-format.test.ts` — channel info, user info, file info formatters
- `api.test.ts` — limit clamping, timestamp conversion, error summarization
- `tools.test.ts` — tool module export verification
- `time-range.test.ts` — deterministic Slack time-range normalization
- `render-helpers.test.ts` — collapsed preview clipping + OSC 8 permalinks
- `preferences-stats.test.ts` — preferences sanitize + stats counters
- `scope-probe.test.ts` — scope probe module export
- `resolve.test.ts` — resolver helper behavior
- `search-plan.test.ts` — search operator planner behavior

Run: `npm test`

## Troubleshooting

**No Slack footer pill appears and no tools are available:**
No token was resolved at `session_start`, or the extension is disabled. Run
`/sf-slack connect`, submit the prefilled `/login sf-slack`, and then run
`/sf-slack refresh`. For automation, set `SLACK_USER_TOKEN` before starting Pi.

**Footer shows `✓ Connected` with fewer known scopes than expected:**
The footer counts known scopes: the union of scopes `sf-slack` requested and
additional scopes Slack returned for the token. A partial count usually means
Slack did not grant one or more requested scopes. `/sf-slack` shows which
capabilities are available and which requested scopes are not included in the
current grant; re-auth only adds scopes if those scopes are approved for your
app/workspace.

**`slack_send action=dm` says `im:write` is missing:**
`im:write` is only needed to open a new 1:1 DM. If the token has DM search
access, `slack_send` first tries to find an already-open `D...` DM channel and
post there after the normal confirmation dialog. If that fallback cannot find a
DM, ask a workspace admin to approve `im:write`, or send to a user-provided
existing `D...` channel ID with `action=channel`.

**A Slack user or channel reference resolves to the wrong target:**
For `slack_send`, the final send dialog includes the selected recipient,
confidence, and alternate matches; cancel and retry with an exact ID/email if it
picked the wrong target. Other Slack tools use the shared select-or-type dialog
below a 0.85 confidence threshold, while headless mode fails loudly with the
candidate list in the error. If you hit low-confidence results a lot, pass
fully-qualified IDs (`C01...`, `U01...`) or email addresses via
`slack_user action=email`.

**`slack_canvas read` says "canvas not found":**
The canvas ID is invalid or the token cannot access that canvas. If `files:read`
is missing, the tool falls back to `canvases.sections.lookup`; if that fallback
also returns not found, verify the `F...` canvas ID and workspace access.

**`slack_canvas read` criteria returns invalid arguments:**
The wrapper validates criteria before calling Slack. Use `criteria.contains` for
text matching and optional `criteria.section_types` values of `h1`, `h2`, `h3`,
or `any_header`. The tool sends Slack's required `contains_text` field on the
wire, so users and agents can keep using the simpler `contains` name.

**`slack_canvas read` returns section IDs but no metadata:**
This is expected when the token has `canvases:read` but lacks `files:read`.
Section IDs are enough for targeted `edit` operations; add `files:read` only if
you need canvas file metadata or file listing.

**Search returns nothing from DMs or multi-party IMs:**
Fixed: all `assistant.search.context` calls default to
`channel_types=public_channel,private_channel,mpim,im`. If you still see
this, your token is missing `search:read.im` or `search:read.mpim`.

**`slack_send` refuses to run in `pi -p` / CI mode:**
By design — the confirm dialog is the safety net. Either run interactively
or set `SLACK_ALLOW_HEADLESS_SEND=1` when you know the environment. For
safe practice runs, add `SLACK_SEND_DRY_RUN=1` to skip the actual API call.

**I need to see what `slack_send` posted (or attempted to post):**
Run `/sf-slack sent`. Every send (real or dry-run, sent or cancelled)
appends a typed audit entry to the session branch.

## Security

- NEVER renders tokens or token fragments in status/configuration output
- Interactive entry uses SF Pi's shared fixed-mask TUI component; Pi owns persistence and logout
- Existing API-key and OAuth-compatible Pi credentials remain readable; `SLACK_USER_TOKEN` is the automation fallback
- All tools are read-only except `slack_canvas` create/edit, `slack_send`, and `slack_schedule` schedule/delete
- `slack_send` always requires an explicit user confirmation in interactive
  mode; headless mode refuses unless `SLACK_ALLOW_HEADLESS_SEND=1`
- No access tokens, credentials, or secrets in agent context or tool output
- Scope probing is header-driven (`X-OAuth-Scopes` on every response) — no
  synthetic API calls, no data exposed

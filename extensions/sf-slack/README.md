# SF Slack — Code Walkthrough

## What It Does

Full Slack integration for pi — search messages, read threads, browse channel
history, look up channels/users/files, read/create/edit canvases, and post
messages with human-in-the-loop confirmation. Includes runtime scope probing
and agent context injection.

The extension registers 9 tools, an auth provider, a status command,
scope probing on session start, and system prompt context injection.

One of those tools (`slack_send`) is the **only** write-to-humans surface in
sf-pi: every call confirms with the user via `ctx.ui.confirm()` before
posting.

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
  ├─ registerProvider("sf-slack")           ← OAuth + manual token support
  ├─ registerCommand("sf-slack")            ← status / refresh / help
  │
  │  Note: no Slack tools are registered at load.
  │  Registration is gated on token availability to keep the
  │  system prompt Slack-free when sf-slack is not configured.
  │
  └─ on("session_start")
       ├─ Resolve token (Pi auth → Keychain → env)
       ├─ If no token → keep footer hidden, DO NOT register tools
       └─ If token found:
            ├─ ensureSlackToolsRegistered()  ← registers 9 slack* tools
            ├─ auth.test → detect identity
            ├─ probeAndGateTools() → disable tools whose scopes Slack did
            │                         not grant (header-driven via the
            │                         X-OAuth-Scopes response header)
            ├─ users.list → pre-warm user cache
            │
            │ All three awaited in parallel so turn-1 already ships the final
            │ (probed, gated) tool set — keeps the prompt prompt-cache-friendly.
            │
            └─ Set footer "Slack: ✓ Ready" or "Slack: ⚠ Limited"
                (`0/N scopes` is never rendered as green/ready)
  on("session_shutdown")
       └─ Clear footer status
  on("before_agent_start")
       ├─ If no Slack tool is active in systemPromptOptions.selectedTools → skip
       └─ Inject [Slack Workspace] identity anchors (User + Team) only
            (cache sizes and gated counts are intentionally omitted — they drift
             turn-to-turn and would invalidate prompt cache)
  /sf-slack
       ├─ UI available + no args → open status & controls panel
       └─ no UI + no args        → show auth status
  /sf-slack refresh
       ├─ If token resolves now but tools were not registered earlier
       │   (e.g. user ran /login mid-session) → ensureSlackToolsRegistered()
       └─ Re-probe scopes, re-warm caches
```

## Auth Setup

Recommended setup order:

| Priority | Source               | When to Use                    | How to Set Up                                                                         |
| -------- | -------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 1        | Pi auth store        | Default interactive setup      | `/login sf-slack`                                                                     |
| 2        | macOS Keychain       | Local macOS secret storage     | `security add-generic-password -a "sf-slack-token" -s "pi-sf-slack" -w "xoxp-..." -U` |
| 3        | Environment variable | Automation / CI / shell-driven | `export SLACK_USER_TOKEN=xoxp-...`                                                    |

`sf-slack` checks these sources in that order. If more than one is configured,
Pi auth wins so the built-in `/login sf-slack` path stays the default behavior.

## macOS Keychain Quick Reference

Use the built-in `security` CLI on macOS.

### Add or update the token

```bash
security add-generic-password \
  -a "sf-slack-token" \
  -s "pi-sf-slack" \
  -w "xoxp-your-token" \
  -U
```

### Verify the token is present

```bash
security find-generic-password \
  -a "sf-slack-token" \
  -s "pi-sf-slack" \
  -w
```

### Delete the token

```bash
security delete-generic-password \
  -a "sf-slack-token" \
  -s "pi-sf-slack"
```

If you want the simplest path, prefer `/login sf-slack`. Use Keychain when you
specifically want macOS-managed local secret storage.

## Obtaining an `xoxp-` User Token

> Warning
>
> This requires a Slack app that is approved in the target workspace and a user
> account that is allowed to install or authorize that app. Some workspaces
> restrict app installs or specific scopes.

If your organization already provides an approved OAuth helper page, you can use
that flow and then store the returned token with `/login sf-slack`, macOS
Keychain, or `SLACK_USER_TOKEN`.

If you need to build or verify the flow yourself, Slack's current user-token
OAuth path for MCP-style integrations is:

```text
https://slack.com/oauth/v2_user/authorize
```

A minimal authorization URL looks like this:

```text
https://slack.com/oauth/v2_user/authorize?client_id=YOUR_CLIENT_ID&scope=search:read.public,search:read.files,users:read,channels:history&redirect_uri=https://YOUR-APP.example.com/slack/callback
```

High-level flow:

1. Create or reuse an approved Slack app.
2. Add the user scopes you need under **OAuth & Permissions**.
3. Configure an HTTPS redirect URL.
4. Send the user through the OAuth consent screen.
5. Exchange the returned `code` using `oauth.v2.user.access`.
6. Store the resulting `xoxp-...` token securely.

Example code exchange:

```bash
curl -X POST https://slack.com/api/oauth.v2.user.access \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=YOUR_CLIENT_ID' \
  --data-urlencode 'client_secret=YOUR_CLIENT_SECRET' \
  --data-urlencode 'code=RETURNED_CODE' \
  --data-urlencode 'redirect_uri=https://YOUR-APP.example.com/slack/callback'
```

Notes:

- For user-token-only and MCP-style flows, prefer `v2_user/authorize` +
  `oauth.v2.user.access`.
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
not automatically broken; `/sf-slack` renders a capability summary so users can
see what is available and what is degraded.

| Profile               | Scopes                                                             | Notes                                                                     |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Public search         | `search:read.public`, `search:read.files`, `search:read.users`     | Search public channels, files, and users                                  |
| Private and DM search | `search:read.private`, `search:read.im`, `search:read.mpim`        | User-token-only scopes; admins may choose not to grant them               |
| Message context       | `channels:history`, `groups:history`, `im:history`, `mpim:history` | Needed for `conversations.history` / `conversations.replies`              |
| Directory metadata    | `channels:read`, `groups:read`, `im:read`, `mpim:read`             | Enables channel info/list/member APIs; search fallbacks exist             |
| User lookup           | `users:read`, `users:read.email`                                   | Email lookup requires `users:read.email`                                  |
| File metadata         | `files:read`                                                       | Separate from `search:read.files`; needed for `files.info`                |
| Canvas sections       | `canvases:read`                                                    | Enables `canvases.sections.lookup` and section ID discovery               |
| Canvas create/edit    | `canvases:write`                                                   | Needs a user token (`xoxp-`)                                              |
| Posting messages      | `chat:write`, `im:write`, `mpim:write`                             | `chat:write` posts to known channels/DM IDs; `im:write` opens new 1:1 DMs |

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
chat:write,chat:write.public,im:write,mpim:write
```

Omit the `chat:*` / `im:write` / `mpim:write` scopes if you do not want message
posting. `slack_send` remains gated and confirmed even when those scopes exist.

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
- **Scope gate** — requires `chat:write` or `chat:write.public`. `action=dm`
  uses `im:write` to open a DM when available; without it, the tool searches
  for an already-open `D...` DM channel and posts there after confirmation.
- **Recipient HITL** — every fuzzy `to` goes through the shared
  `requireConfirmedChannel` / `requireConfirmedUser` helper in
  `lib/recipient-confirm.ts`. Below-threshold matches pop a select-or-type
  dialog; headless mode fails loudly with the full candidate list.
- **Broadcast re-confirm** — `@channel`, `@here`, `@everyone`, and
  `<!subteam ...>` user-group pings flip the confirm dialog's default to
  Cancel.
- **Dry-run** — `SLACK_SEND_DRY_RUN=1` runs the full confirm UX and audit
  entry without calling Slack.
- **Audit trail** — every send (including dry-runs and cancellations) is
  appended to the session via `pi.appendEntry(SEND_ENTRY_TYPE, ...)`. View
  with `/sf-slack sent`.

Never returns raw tokens or credentials in its output.

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
| `slack_send`           | `chat:write` or `chat:write.public`                                              | DMs can reuse an existing `D...` channel; opening a new DM still needs `im:write`; all sends require HITL |

`/sf-slack` renders both the raw granted/requested scope diff and a capability
summary such as Search, History, Files, Canvases, and Posting. This keeps a
16-of-23 scope grant understandable instead of making it look like a broken
login.

## Agent Context Injection

On every `before_agent_start`, when at least one `slack*` tool is active the
extension injects the minimum Slack context the LLM needs to interpret
`from:me` / `with:@user` references correctly:

```
[Slack Workspace]
User: @username (U01ABC123)
Team: T01XYZ789
```

Cache sizes and gated-tool counts are intentionally **not** included because
they drift turn-to-turn and would invalidate prompt cache on every call.
Those metrics live in the footer and the research-activity widget instead.

The injected block is NOT displayed to the user (`display: false`) — only
visible to the LLM.

## Commands

| Command              | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `/sf-slack`          | Open status & controls panel in UI; show auth status in no-UI mode |
| `/sf-slack status`   | Show auth status and connection info                               |
| `/sf-slack refresh`  | Re-detect identity, re-probe scopes, refresh cache                 |
| `/sf-slack settings` | Open preferences (search detail, widget, permalinks)               |
| `/sf-slack sent`     | List `slack_send` activity in the current branch                   |
| `/sf-slack help`     | Show command help                                                  |

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
| `/sf-slack`          | UI available                    | Open status & controls panel                                                   |
| `/sf-slack`          | no UI                           | Show auth status                                                               |
| `/sf-slack refresh`  | token resolves now              | Register tools if needed, re-probe scopes, refresh cache                       |
| any tool call        | no auth                         | Return setup instructions (defensive; normally unreachable)                    |

## Environment Variables

| Variable                    | Required | Description                                                                            |
| --------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `SLACK_USER_TOKEN`          | Optional | Slack user OAuth token (xoxp-...) for automation                                       |
| `SLACK_TEAM_ID`             | Optional | Workspace or enterprise grid team ID                                                   |
| `SLACK_CLIENT_ID`           | Optional | OAuth app client ID (enables OAuth flow)                                               |
| `SLACK_CLIENT_SECRET`       | Optional | OAuth app client secret                                                                |
| `SLACK_REDIRECT_URI`        | Optional | OAuth redirect URI                                                                     |
| `SLACK_SCOPES`              | Optional | Override default scope list                                                            |
| `SLACK_ALLOW_HEADLESS_SEND` | Optional | `1` allows `slack_send` in non-interactive mode (`pi -p`, RPC). Default refuses.       |
| `SLACK_SEND_DRY_RUN`        | Optional | `1` runs the full `slack_send` confirm UX + audit entry without calling the Slack API. |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-slack/
  lib/
    api.ts                  ← implementation module
    auth.ts                 ← implementation module
    canvas-tool.ts          ← implementation module
    channel-tool.ts         ← implementation module
    config-panel.ts         ← implementation module
    emoji.ts                ← implementation module
    file-tool.ts            ← implementation module
    format.ts               ← implementation module
    preferences.ts          ← implementation module
    recipient-confirm.ts    ← implementation module
    render.ts               ← implementation module
    research-tool.ts        ← implementation module
    resolve-tool.ts         ← implementation module
    resolve.ts              ← implementation module
    scope-probe.ts          ← implementation module
    search-plan.ts          ← implementation module
    send-tool.ts            ← implementation module
    settings-panel.ts       ← implementation module
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
No token was resolved at `session_start`, or the extension is disabled. Set one
via `/login sf-slack`, macOS Keychain (`sf-slack-token` / `pi-sf-slack`), or
`SLACK_USER_TOKEN`, then run `/sf-slack refresh` to register tools without
restarting.

**Footer shows `⚠ Limited` or missing granted scopes:**
Your token has fewer scopes than `DEFAULT_SCOPES` requests. This may be normal
when your OAuth app or workspace is approved for only a subset of scopes.
`/sf-slack` shows exactly which scopes are missing; re-auth only helps if those
scopes are actually approved for your app/workspace.

**`slack_send action=dm` says `im:write` is missing:**
`im:write` is only needed to open a new 1:1 DM. If the token has DM search
access, `slack_send` first tries to find an already-open `D...` DM channel and
post there after the normal confirmation dialog. If that fallback cannot find a
DM, ask a workspace admin to approve `im:write`, or send to a user-provided
existing `D...` channel ID with `action=channel`.

**A Slack user or channel reference resolves to the wrong target:**
Below a 0.85 confidence threshold, resolution pops a select-or-type
dialog in interactive mode; in headless mode it fails loudly with the
candidate list in the error. If you hit low-confidence results a lot,
pass fully-qualified IDs (`C01...`, `U01...`) or email addresses via
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

- NEVER exposes full tokens — always masked in display
- Recommended auth path is Pi's built-in `/login sf-slack` storage
- Optional local secret storage is available via macOS Keychain
- All tools are read-only except `slack_canvas` create/edit and `slack_send`
- `slack_send` always requires an explicit user confirmation in interactive
  mode; headless mode refuses unless `SLACK_ALLOW_HEADLESS_SEND=1`
- No access tokens, credentials, or secrets in agent context or tool output
- Scope probing is header-driven (`X-OAuth-Scopes` on every response) — no
  synthetic API calls, no data exposed

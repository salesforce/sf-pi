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
       ├─ If no token → set footer "Slack: not configured", DO NOT register tools
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
            └─ Set footer "Slack: @username · N cached · M gated · ⚠ K requested scopes not granted"
                (the ⚠ segment only appears when the granted scope set
                 differs from what we requested at OAuth time)
  on("session_shutdown")
       └─ Clear footer status
  on("before_agent_start")
       ├─ If no Slack tool is active in systemPromptOptions.selectedTools → skip
       └─ Inject [Slack Workspace] identity anchors (User + Team) only
            (cache sizes and gated counts are intentionally omitted — they drift
             turn-to-turn and would invalidate prompt cache)
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

| Goal                             | Scopes                                                             | Notes                                                        |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Public search                    | `search:read.public`, `search:read.files`, `search:read.users`     | Search public channels, files, and users                     |
| Private and DM search            | `search:read.private`, `search:read.im`, `search:read.mpim`        | User-token-only scopes; users can revoke these later         |
| Read full channel/thread context | `channels:history`, `groups:history`, `im:history`, `mpim:history` | Needed for `conversations.history` / `conversations.replies` |
| Channel discovery and metadata   | `channels:read`, `groups:read`, `im:read`, `mpim:read`             | Needed for channel info, list, and members flows             |
| User lookup and email            | `users:read`, `users:read.email`                                   | Email lookup requires `users:read.email`                     |
| File metadata / downloads        | `files:read`                                                       | Separate from `search:read.files`                            |
| Canvases                         | `canvases:read`, `canvases:write`                                  | Read, create, and edit canvases                              |
| Posting messages                 | `chat:write`                                                       | Only needed if you want write actions                        |

### Maximum coverage for this extension

If your goal is broad `sf-slack` coverage, including private channels, DMs,
MPDMs, file lookups, user email lookup, and canvases, request at least:

```text
search:read.public,search:read.files,search:read.users,
search:read.private,search:read.im,search:read.mpim,
channels:history,groups:history,im:history,mpim:history,
channels:read,groups:read,im:read,mpim:read,
users:read,users:read.email,files:read,
canvases:read,canvases:write
```

Add `chat:write` only if you also want message posting or MCP message actions.

### Scope caveats

- `search:read.files` lets you search for files, but `files:read` is still
  needed if you want file metadata or content retrieval.
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

| Action   | Parameters                                         | API                                       | Description                   |
| -------- | -------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| `read`   | `canvas_id`, `criteria`                            | `files.info` / `canvases.sections.lookup` | Canvas content or section IDs |
| `create` | `title`, `markdown`, `channel_id`                  | `canvases.create`                         | Create a new canvas           |
| `edit`   | `canvas_id`, `operation`, `markdown`, `section_id` | `canvases.edit`                           | Modify an existing canvas     |

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
- **Scope gate** — requires `chat:write` or `chat:write.public`; `action=dm`
  additionally requires `im:write`.
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

On `session_start`, the extension probes the token's actual scopes by making
lightweight API calls. Tools whose required scopes are missing are dynamically
removed from the active tool set, keeping the LLM system prompt clean.

| Scope           | Probe Endpoint       | Gated Tools     |
| --------------- | -------------------- | --------------- |
| `channels:read` | `conversations.info` | `slack_channel` |
| `files:read`    | `files.list`         | `slack_file`    |

Tools with missing scopes have graceful fallbacks where possible (e.g.,
discovering channels via search, finding members from history).

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

| Command              | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `/sf-slack`          | Show auth status and connection info                 |
| `/sf-slack refresh`  | Re-detect identity, re-probe scopes, refresh cache   |
| `/sf-slack settings` | Open preferences (search detail, widget, permalinks) |
| `/sf-slack sent`     | List `slack_send` activity in the current branch     |
| `/sf-slack help`     | Show command help                                    |

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
| `session_start`      | no token                        | Skip tool registration entirely, set footer "Slack: not configured"            |
| `session_shutdown`   | —                               | Clear footer status                                                            |
| `before_agent_start` | identity + at least one slack\* | Inject minimal workspace context (User + Team only)                            |
| `before_agent_start` | no identity / no slack tools    | Skip injection                                                                 |
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

```
extensions/sf-slack/
  index.ts              ← entry point: events, commands, provider, all tool registration
  manifest.json         ← metadata (configurable: true)
  README.md             ← this file
  lib/
    types.ts            ← constants, env vars, all 9 parameter schemas, result types
    auth.ts             ← token resolution chain, Pi auth / Keychain / env helpers, OAuth login/refresh
    api.ts              ← slackApi(), slackApiJson(), user cache, timestamp/error helpers
    format.ts           ← text formatters for all tools + auth status (honors fields mode)
    render.ts           ← TUI renderCall/renderResult for slack tool + mrkdwn→ANSI (collapsed/expanded + OSC 8)
    emoji.ts            ← Slack emoji shortcode ↔ unicode helpers used by render/format
    tools.ts            ← registerSlackTool() — search/thread/history/permalink/auth
    time-range.ts       ← deterministic timezone/date math for Slack boundaries
    time-range-tool.ts  ← registerTimeRangeTool() — slack_time_range
    resolve.ts          ← fuzzy channel/user resolver with confidence scoring
    search-plan.ts      ← Slack search operator planner and fallback query builder
    resolve-tool.ts     ← registerResolveTool() — channel/user resolution
    research-tool.ts    ← registerResearchTool() — operator-aware Slack research
    channel-tool.ts     ← registerChannelTool() — info/list/members with scope fallbacks
    user-tool.ts        ← registerUserTool() — info/email/presence/list
    file-tool.ts        ← registerFileTool() — info/list
    canvas-tool.ts      ← registerCanvasTool() — read/create/edit
    send-tool.ts        ← registerSendTool() — slack_send (HITL confirm + audit)
    recipient-confirm.ts← shared HITL helper: requireConfirmedChannel / requireConfirmedUser
    truncation.ts       ← Pi truncation helpers + temp-file persistence for long outputs
    scope-probe.ts      ← probeAndGateTools() — runtime scope detection + tool gating
    config-panel.ts     ← config panel component for Extension Manager drill-down
    preferences.ts      ← in-memory + pi.appendEntry-backed user prefs (fields, widget, permalinks)
    settings-panel.ts   ← `/sf-slack settings` SettingsList overlay
    stats.ts            ← per-session research-activity counters and widget rendering
  tests/
    smoke.test.ts                    ← module export check
    auth.test.ts                     ← token parsing, precedence helpers, masking, expiry formatting
    auth-status.test.ts              ← buildAuthStatus rendering across auth sources
    format.test.ts                   ← search results, messages, structured extractors
    field-modes.test.ts              ← summary/preview/full body trimming contract
    extra-format.test.ts             ← channel, user, file formatters
    api.test.ts                      ← clampLimit, tsToLabel, relativeTime, error summarization
    tools.test.ts                    ← tool module export checks (channel, user, file, canvas)
    send-tool.test.ts                ← slack_send HITL + safety rail coverage
    recipient-confirm.test.ts        ← shared HITL helper thresholds + retry loop
    canvas-preflight.test.ts         ← canvas read/create/edit fallback paths
    render-helpers.test.ts           ← collapsed preview clipping + OSC 8 permalinks
    render-snapshot.test.ts          ← stable render output snapshots
    preferences-stats.test.ts        ← preferences sanitize + stats counters
    scope-probe.test.ts              ← scope probe module export check
    resolve.test.ts                  ← resolver helper tests
    search-plan.test.ts              ← search operator planner tests
    time-range.test.ts               ← deterministic Slack time-range normalization
    channel-cache-from-search.test.ts← channel cache population via search fallback
    channel-types-default.test.ts    ← default types filter for conversations.list
    user-cache-from-search.test.ts   ← user cache population via search fallback
    registration-gate.test.ts        ← tool registration only after token resolves
    emoji.test.ts                    ← shortcode ↔ unicode round-trip
    prompt-surface.test.ts           ← system-prompt injection contract
    system-prompt-options.test.ts    ← before_agent_start skip conditions
    truncation.test.ts               ← long-output temp-file persistence
  roadmap/
    01-channel-tool.md  ← ✅ Implemented
    02-user-tool.md     ← ✅ Implemented
    03-file-tool.md     ← ✅ Implemented
    04-canvas-tool.md   ← ✅ Implemented
    05-scope-probing.md ← ✅ Implemented
    06-agent-context.md ← ✅ Implemented
```

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

**Footer shows `Slack: not configured` and no tools are available:**
No token was resolved at `session_start`. Set one via `/login sf-slack`,
macOS Keychain (`sf-slack-token` / `pi-sf-slack`), or `SLACK_USER_TOKEN`,
then run `/sf-slack refresh` to register tools without restarting.

**Footer shows `⚠ N requested scopes not granted`:**
Your token was issued with a narrower scope set than `DEFAULT_SCOPES`
requests. `/sf-slack` shows exactly which scopes are missing. Slack scopes
are additive — re-run OAuth and accept the extra scopes, or revoke and
re-authorize to trim them down.

**`slack_send` returns a `missing_scope` error mentioning four write scopes:**
The preflight now gates `action=dm` against `im:write` specifically before
showing the confirm dialog. If you see the bulk list, your token predates
that preflight and needs a re-consent. Use `action=channel` with an
existing `D...` channel ID as a workaround.

**A Slack user or channel reference resolves to the wrong target:**
Below a 0.85 confidence threshold, resolution pops a select-or-type
dialog in interactive mode; in headless mode it fails loudly with the
candidate list in the error. If you hit low-confidence results a lot,
pass fully-qualified IDs (`C01...`, `U01...`) or email addresses via
`slack_user action=email`.

**`slack_canvas read` says "canvas not found":**
The canvas ID is invalid or you lack `files:read` / `canvases:read`. The
fallback probes both; the error names which one actually failed. Verify
the ID with `slack_resolve` or re-consent with `canvases:read` added.

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

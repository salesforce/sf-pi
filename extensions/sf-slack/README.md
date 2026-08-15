# SF Slack

## What It Does

SF Slack provides Slack research, message/thread history, entity resolution,
channel/user/file lookup, canvas operations, human-confirmed message delivery,
and API-scheduled message management. It works with partial scope grants and
registers only capabilities the current token can support.

## Capabilities

| Tool               | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `slack_time_range` | Convert human date ranges to deterministic Slack boundaries     |
| `slack_research`   | Build strict-to-broad searches and optionally fetch threads     |
| `slack_resolve`    | Resolve fuzzy channels/users with confidence and alternates     |
| `slack`            | Search messages, read history/threads, and get permalinks       |
| `slack_channel`    | Channel info, listing, and members                              |
| `slack_user`       | User directory, email lookup, profile, and presence             |
| `slack_file`       | File metadata and listings                                      |
| `slack_canvas`     | Read sections or create/edit canvases                           |
| `slack_send`       | Human-confirmed channel, DM, or thread posts                    |
| `slack_schedule`   | Human-confirmed scheduling/deletion and pending-message listing |

Research should start with summary or preview fields and fetch full bodies only
when needed. Relative dates should pass through `slack_time_range`; fuzzy
entities should pass through `slack_resolve`. Low-confidence matches require
clarification instead of silently broadening or choosing a target.

## Commands

| Command                | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `/sf-slack`            | Open SF Slack in the Manager; print status without UI  |
| `/sf-slack connect`    | Prepare native masked login guidance                   |
| `/sf-slack disconnect` | Prefill native logout for review                       |
| `/sf-slack status`     | Show credential, identity, scope, and capability state |
| `/sf-slack refresh`    | Re-probe identity/scopes and refresh caches            |
| `/sf-slack settings`   | Open search-detail, widget, and permalink preferences  |
| `/sf-slack sent`       | List current-branch delivery activity                  |
| `/sf-slack help`       | Print usage guidance                                   |

## Configuration

Use `/sf-slack connect`, then native `/login sf-slack`. Pi owns credential
persistence and logout. `SLACK_USER_TOKEN` is a non-persisted automation
fallback; a usable Pi credential wins when both exist.

Request only the scopes needed for the intended workflow. Common groups are:

| Capability          | Representative user-token scopes                                   |
| ------------------- | ------------------------------------------------------------------ |
| Public search       | `search:read.public`, `search:read.files`, `search:read.users`     |
| Private/DM search   | `search:read.private`, `search:read.im`, `search:read.mpim`        |
| Message context     | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| Directory and files | `channels:read`, `users:read`, `users:read.email`, `files:read`    |
| Canvases            | `canvases:read`, `canvases:write`                                  |
| Delivery            | `chat:write`; `im:write`/`mpim:write` when opening conversations   |

Slack's granted `X-OAuth-Scopes` response header is authoritative. `/sf-slack`
shows the grant and capability degradation. Reauthorizing can add scopes; revoke
and reauthorize to reduce them.

Preferences live under `sfPi.slack`. Project values override global values.
Search detail `auto` follows the shared display profile (`summary`, `preview`, or
`full`), while an explicit tool `fields` argument wins.

Automation controls:

- `SLACK_USER_TOKEN` — user-token fallback;
- `SLACK_TEAM_ID` — optional workspace selector;
- `SLACK_ALLOW_HEADLESS_SEND=1` — explicitly permit requested delivery in
  non-interactive mode;
- `SLACK_SEND_DRY_RUN=1` — rehearse send/schedule confirmation and audit without
  calling Slack.

## Safety and Data Boundaries

- Reads are the default. Mutating surfaces are canvas create/edit, message send,
  and schedule/delete.
- Every `slack_send` and schedule/delete action requires interactive confirmation
  unless the process has the explicit headless delivery override.
- Bot/app tokens are rejected for user-context delivery. Recipient resolution,
  message preview, confidence, and alternates are shown in the final dialog.
- Broadcast mentions default the confirmation to Cancel.
- Delivery attempts, dry runs, and cancellations are recorded in the session;
  tokens are never rendered or returned.
- Scheduled messages use Slack's supported public Web API queue. They can be
  listed programmatically but are not client-side Scheduled drafts.
- Slack content is research-only for public repository work: distill concepts and
  write fresh generic examples without names, ids, channels, permalinks, or
  private wording.

## Troubleshooting

**No Slack status or tools appear:** Connect with native login, then run
`/sf-slack refresh`. For automation, set `SLACK_USER_TOKEN` before starting Pi.

**Status says connected but limited:** The token is valid but lacks one or more
requested scopes. Use `/sf-slack` to see exact available and gated capabilities.

**Status reports a bot or unsupported token:** Reads may work, but delivery and
some canvas operations require a user token.

**Opening a DM says `im:write` is missing:** SF Slack first tries an existing DM
when search access permits. To open a new DM, request `im:write` or supply an
already known DM channel id.

**A fuzzy person/channel resolves incorrectly:** Cancel and retry with an exact
Slack id or email. Headless low-confidence matches fail with candidates.

**Canvas read cannot find content:** Verify the canvas id and access. Metadata
reads need `files:read`; section lookup needs `canvases:read`.

**Scheduled delivery is absent from the Slack client Scheduled tab:** API queue
items are exposed by `chat.scheduledMessages.list`, not the client draft UI.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-slack/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

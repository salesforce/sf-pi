# ADR 0007: Single-place credential entry per integration

## Status

Accepted (sign-off recorded for Phases A–D plus the additions below).

### Sign-off additions

The accepted scope expands the original proposal:

- **`/login` retired for these integrations.** pi's `/login <provider>` flow
  is no longer the recommended path for sf-llm-gateway or sf-slack.
  `pi.registerProvider`'s OAuth block stays wired so pi-native auth
  resolution still works, but the panel becomes the only documented
  surface and `/login` disappears from help text, README "Connecting"
  sections, and onboarding copy.
- **Keychain retired for sf-slack.** sf-slack drops macOS Keychain from
  its read precedence. A one-time migration copies any Keychain token
  into pi's auth store on first launch, then writes a deprecation
  notification to the user. The Keychain entry is left intact (we
  don't reach into a system credential store and delete things
  silently).
- **Env vars and direct file edits stay.** Both remain supported as
  automation/power-user fallbacks. They are documented in the
  "Advanced / automation" subsection only.
- **Central credential registry: use pi-native.** pi's existing
  `~/.pi/agent/auth.json` (written by `/login` and `pi.registerProvider`'s
  OAuth callbacks) is the canonical place. Both integrations write there.
  No new credential format is invented.
- **Migrations are automatic.** When the runtime detects credentials
  in a now-deprecated location, it copies them into the canonical
  location and surfaces a one-time notification explaining the move.

## Context

End users currently see 3+ different ways to configure credentials for both
the SF LLM Gateway and SF Slack integrations. The slash menu also shows two
adjacent rows for the gateway (`/sf-llm-gateway` and the legacy
`/sf-llm-gateway-internal`). New users have to read the README to learn which
path is canonical, and existing users sometimes configure one source while
the runtime is reading from another — both are valid, neither is "wrong",
but the result is "I configured it and it still says not connected".

This ADR proposes a single-entry-point UX per integration, with the existing
fallbacks kept available for automation but not surfaced to new users.

### Inventory of today's entry points

#### SF LLM Gateway

| #   | Where                                                                           | Purpose                                      | Audience             |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------- | -------------------- |
| 1   | `/sf-llm-gateway` panel → **Open setup / settings**                             | URL + token form, writes saved config JSON   | All users            |
| 2   | `/sf-llm-gateway-internal` slash command                                        | Backward-compatible alias of #1              | Legacy muscle memory |
| 3   | `/login sf-llm-gateway-internal`                                                | pi's standard provider login (OAuth/API key) | Standardized pi flow |
| 4   | `SF_LLM_GATEWAY_INTERNAL_BASE_URL` / `SF_LLM_GATEWAY_INTERNAL_API_KEY` env vars | Per-shell automation override                | Automation / CI      |
| 5   | Direct edit of saved JSON (global or project)                                   | Provisioning by config management            | Power users          |

Storage on disk:

- Global: `~/.pi/agent/sf-llm-gateway-internal.json` (chmod 0600)
- Project: `<repo>/.pi/sf-llm-gateway-internal.json` (chmod 0600)

Resolution precedence today (see `lib/config.ts: getGatewayConfig`):
**saved (project) > saved (global) > env > default**.

#### SF Slack

| #   | Where                                              | Purpose                                                                                        | Audience                                          |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `/login sf-slack`                                  | pi's standard OAuth flow → `~/.pi/agent/auth.json`                                             | Standardized pi flow (the recommended path today) |
| 2   | macOS Keychain via `security add-generic-password` | Hardware-backed local secret                                                                   | Power users on macOS                              |
| 3   | `SLACK_USER_TOKEN` env var                         | Per-shell automation override                                                                  | Automation / CI                                   |
| 4   | `/sf-slack` panel                                  | **Today: no Connect / login action** — only status, refresh, settings, send audit, help, close | (gap)                                             |

Resolution precedence today (see `lib/auth.ts: resolveTokenCandidates`):
**pi-auth > keychain > env**.

### Why the duplication exists

- The gateway's `/sf-llm-gateway-internal` slash command was renamed to the
  friendlier `/sf-llm-gateway` and the original was kept as a back-compat
  alias. The alias has been around several minor releases and can now be
  retired.
- The gateway's setup overlay was added before the standard `/login`
  provider-registration flow was wired up. Both paths now coexist and write
  to the same on-disk JSON, but they're presented to users as if they were
  two unrelated UIs.
- The Slack extension was built around the pi auth store and `/login`. The
  `/sf-slack` panel was added later for status/diagnostics but never grew a
  Connect action because `/login` was already "good enough" — except users
  inside `/sf-slack` have no obvious way back to it from there.

## Decision

Each integration gets exactly one user-facing primary entry point: the
extension's own panel (`/sf-llm-gateway` and `/sf-slack`). Every other
path is preserved (env vars, Keychain, `/login`, direct file edits) for
advanced/automation use, but is not advertised in onboarding flows or
beginner-facing UI.

### Principle: Connect lives in the panel

Both panels grow a single **Connect / Re-authenticate** action at the top
of their action list. That action:

1. Opens an inline overlay (URL+token form for gateway, OAuth flow for
   Slack).
2. Writes credentials to the standard storage location for that integration
   (`~/.pi/agent/<provider>.json` for the gateway, `~/.pi/agent/auth.json`
   for Slack).
3. On success, refreshes the panel status and closes the overlay.
4. On failure, surfaces the error inline and leaves prior credentials
   untouched.

Both panels' status block clearly shows which source the runtime resolved
from: `Connected via panel setup` / `Connected via /login` / `Using
SLACK_USER_TOKEN env var`. That makes it obvious when a user has configured
one source but the runtime is reading another.

### Non-goal: removing fallback paths

This ADR does **not** remove `/login`, env vars, Keychain, or direct file
edits. Those remain working and supported. They move out of the "happy
path onboarding" copy and into a single "Advanced / automation" subsection
of each integration's README and panel help. The lint already requires a
panel; this ADR adds one required action row to that contract.

## Phased rollout

### Phase A — Slash menu de-duplication (1-file change)

- Remove the registration of `/sf-llm-gateway-internal` from
  `extensions/sf-llm-gateway-internal/index.ts`.
- Keep the **provider id** `"sf-llm-gateway-internal"` (used by
  `pi.registerProvider`, `/login`, settings keys, env var prefixes). The
  cleanup is purely the slash command surface.
- Document the retirement in the panel help text and the extension's
  README. If a user types `/sf-llm-gateway-internal`, pi's "unknown
  command" message points them at `/sf-llm-gateway`.

**Risk**: muscle memory. The alias has been deprecated in copy for
multiple releases, so this is overdue.

### Phase B — Gateway: panel-side Connect action

- Add a `connect` action at the top of `/sf-llm-gateway`'s action list.
  Opens the existing setup overlay (URL+token form). On save, runs the
  same persistence path as `Open setup / settings`.
- Demote the existing `Open setup / settings` row to a **More**
  group, with a description that points at Connect for first-time setup.
- The status block grows a new field — `Source` — showing
  `panel setup` / `/login` / `env (BASE_URL_ENV)` /
  `env (API_KEY_ENV)` / `not connected`. Use the existing
  `getGatewayConfig().baseUrlSource` / `apiKeySource` fields.
- The panel status `Connection` row already exists and stays as-is.

### Phase C — Slack: panel-side Connect action

- Add a `connect` action at the top of `/sf-slack`'s action list.
  Calls `loginSlack(callbacks)` from `lib/auth.ts` inside an overlay
  (`ctx.ui.custom`) and persists via `pi.registerProvider`'s OAuth helper
  — the same path `/login sf-slack` uses today. No new persistence layer.
- Disconnect (clear pi-auth token + Keychain entry) becomes a separate
  row. Does **not** touch `SLACK_USER_TOKEN` env var because the user
  owns that.
- The status block grows the same `Source` field with the value coming
  from `detectTokenSource()`.

### Phase D — Help / README cleanup (docs only)

- Each integration's README gets a single "Connecting" section that
  starts with the panel command. Env-var, Keychain, and `/login` are
  moved to a "Advanced / automation" subsection.
- The panel `help` action in each integration prints the same Connecting
  flow, with one bullet per advanced fallback.

### Phase E — Optional onboarding wizard (nice-to-have, not blocking)

- A `/sf-pi onboard` slash command surfaces every integration that's
  installed-but-not-connected and offers to walk through Connect for each.
- Useful for first-launch demo videos and new-machine setup. Skipping
  this phase has zero impact on the consolidation goal.

## Out of scope

- **Migration of existing on-disk credentials.** Both integrations already
  read from their standard locations, so existing users see no change in
  the runtime. The Connect action writes to the same locations.
- **Hardware-backed secret storage on Linux/Windows.** Slack's macOS
  Keychain integration stays as-is. Cross-platform secret storage is a
  separate ADR.
- **Removing `/login <provider>`**. pi's standard auth surface stays.
  Power users can continue to use it; the panel's Connect action is the
  bigger door.
- **A central `/sf-pi credentials` registry.** Tempting, but it would just
  add a fourth entry point. The integration-owned panel is the right scope.

## Consequences

Positive:

- New users see one row per integration in the slash menu, one Connect
  action inside the panel, and a Source field that explains which source
  is winning. The "I configured X but it still says not connected" trap
  goes away.
- The panel-consistency lint can grow a "panel exposes a Connect action
  for any integration that registers a pi provider OR a custom auth
  store" rule, so future integrations land with the same UX.

Negative:

- Slight duplication of overlay code: `/sf-llm-gateway` Connect and
  `Open setup / settings` open the same overlay. Not a real cost — the
  overlay is shared via `lib/config-panel.ts`.
- The Slack `connect` action requires plumbing `loginSlack` into the
  panel's `onAction` flow. Not difficult; the function already exists.

## Implementation order

Phases A–D ship together in `v0.56.0`. Phase E is deferred to a follow-up
ADR. Migration logic for Keychain → pi auth store is bundled into Phase C.
A central-credential-registry consolidation pass that audits whether any
integration writes outside `~/.pi/agent/auth.json` (and folds them in if
it's safe) is tracked as a follow-up after this ADR lands.

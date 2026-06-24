# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Breaking Changes

- **Migrated pi peer-dependency scope from `@mariozechner/*` to
  `@earendil-works/*` (pi 0.74).** Pi 0.74.0 (2026-05-07) renamed every
  package — `pi-coding-agent`, `pi-ai`, `pi-tui` — to the new
  `@earendil-works` npm scope and moved its source repo to
  [`earendil-works/pi`](https://github.com/earendil-works/pi). sf-pi follows
  the rename in lockstep:
  - `peerDependencies` and `devDependencies` updated to
    `@earendil-works/pi-{coding-agent,ai,tui}@>=0.74.0`.
  - All ~100 source files now `import` from the new scope.
  - Theme `$schema` URL repointed at `earendil-works/pi`.
  - GitHub workflow + dependabot + doctor install commands updated.

  **Action required for users:** run `pi update --self` from any pi 0.73.1+
  install — pi self-updates uninstalls `@mariozechner/pi-coding-agent` and
  installs `@earendil-works/pi-coding-agent` automatically. Users on pi
  0.73.0 (the bridge release without self-update support) need to run
  `npm uninstall -g @mariozechner/pi-coding-agent && npm install -g
  @earendil-works/pi-coding-agent@latest` once. After the migration,
  `pi --version` should report `0.74.0` or newer and sf-pi will load
  cleanly.

  The `requirePiVersion()` gate in `lib/common/pi-compat.ts` and the
  doctor's npm-root probe both fall back to the legacy `@mariozechner`
  scope, so a half-migrated install still reports a real version number
  and a useful upgrade hint instead of "unknown".

- **Raised pi-coding-agent peerDependency floor to `>=0.74.0`.** sf-pi now
  requires pi 0.74+ — the first version published under the
  `@earendil-works` scope. Running sf-pi against pi 0.73.x or older will
  trip `requirePiVersion()`, which logs a single actionable warning per
  extension ("requires pi-coding-agent >= 0.74.0, found <x>. Run
  `pi update --self` to migrate from `@mariozechner/pi-coding-agent` to
  `@earendil-works/pi-coding-agent`...") and short-circuits so the rest of
  pi keeps starting instead of crashing with `schema validation failed` or
  `ctx.ui.<method> is not a function`.

### Changed

- **Raised pi-coding-agent peerDependency floor to `>=0.74.1`.** Pi 0.74.1
  (2026-05-16) ships three fixes that affect sf-pi extensions directly:
  Node 26 OpenAI-compatible streams no longer time out after five idle
  minutes (pi-mono #4519), `--resume` no longer OOMs on large session
  histories (#4583), and the skill-name-vs-parent-directory diagnostic
  warning is gone (#4534). Improved markdown list / checkbox / inline-image
  rendering also flows through to the sf-welcome splash, sf-skills HUD, and
  sf-devbar via pi-tui. The `requirePiVersion()` gate in
  `lib/common/pi-compat.ts` continues to log a single actionable warning per
  extension when a user runs against an older pi.
- **Simplified `peerDependencies` to a single entry.** `@earendil-works/pi-ai`
  and `@earendil-works/pi-tui` are transitive of `pi-coding-agent` and ship
  in lockstep — pinning them as separate peers added two ways for an install
  to be half-satisfied without any real correctness benefit. The runtime
  `requirePiVersion()` check enforces the version floor end-to-end, so
  `peerDependencies` now lists only `@earendil-works/pi-coding-agent` and
  `typebox`. Verified that `parseChangelog` in
  `lib/common/catalog-state/whats-new.ts` already handles pi 0.74.1's
  changelog layout (`### New Features` / `### Added` / `### Fixed`) — the
  fixture in `lib/common/tests/changelog-summary.test.ts` covers the same
  shape.
- Updated the `### Supported platforms` README paragraph to reflect that
  pi 0.74.1 ships standalone Windows ARM64 binaries; the `sf` CLI is now the
  only Windows prerequisite. WSL is still recommended for shell parity with
  Linux/macOS, but native Windows is no longer flagged as best-effort.

### Features

- **Adopt pi 0.72 model-level `thinkingLevelMap` in
  sf-llm-gateway-internal.** Pi 0.72 replaced `compat.reasoningEffortMap`
  with a top-level `thinkingLevelMap` on each model (pi-mono #3208). The
  Codex gateway clamp (`minimal` → `low`, `xhigh` → `high`) that used to
  live on `CODEX_OPENAI_COMPAT.reasoningEffortMap` is now emitted as
  `thinkingLevelMap` in `buildProviderModel`. Without this migration,
  Codex on pi ≥ 0.72 would silently drop the pi-level → provider-effort
  mapping and hit LiteLLM 400s for `minimal`/`xhigh`.
- **Expose `xhigh` thinking for Opus 4.7 on the SF LLM Gateway.** Pi 0.72
  treats `xhigh` as opt-in via `thinkingLevelMap.xhigh`
  (`getSupportedThinkingLevels` requires `mapped !== undefined`).
  Opus 4.7's gateway presets had no `thinkingLevelMap`, so pi hid `xhigh`
  from the `/thinking` selector and silently clamped
  `DEFAULT_THINKING_LEVEL = "xhigh"` down to `high`. All four Opus 4.7
  presets (`claude-opus-4-7`, `claude-opus-4-7-v1`,
  `claude-opus-4-7-20250416`, `us.anthropic.claude-opus-4-7-v1`) now
  declare `thinkingLevelMap: { xhigh: "xhigh" }`, routing straight through
  to the Anthropic `xhigh` effort tier already handled by
  `mapPiLevelToOpus47Effort` in `transport.ts`. Opus 4.6 is intentionally
  unchanged: pi-ai's default mapping has no `xhigh` case for 4.6, and
  surfacing `xhigh` there without a live probe would silently route heavy
  4.6 traffic to an unmapped tier.
- **Simplify sf-llm-gateway-internal dispatcher with per-model
  `baseUrl`.** Pi 0.72 honors per-model `baseUrl` overrides on
  `pi.registerProvider()` (pi-mono #4063). Anthropic-tagged models are now
  registered with `baseUrl` pinned to the gateway root, so the
  `unifiedStream` dispatcher no longer needs to clone each model and
  rewrite its `baseUrl` at request time. The dispatcher keeps the
  OpenAI-compat ↔ Anthropic-native routing (required to hit our Opus 4.7
  max_tokens shim and the SSE early-error retry wrapper in
  `transport.ts`), but the boilerplate explanation in `discovery.ts`
  shrinks from ~20 lines to ~8.
- **Drop pi 0.70-era compatibility casts.** Now that the floor is 0.73,
  the `ProviderConfigWithName` structural cast in
  `sf-llm-gateway-internal/lib/discovery.ts` and the `pi.on as unknown
  as ...` cast around `thinking_level_select` in `sf-devbar/index.ts` are
  gone; both use the real `ProviderConfig` / event typings from
  `@mariozechner/pi-coding-agent`.

- **Pi 0.72 stop-after-turn availability.** Pi 0.72 also introduces
  `shouldStopAfterTurn` (post-turn stop callback inherited from
  `@mariozechner/pi-agent-core`). No sf-pi extension needs it today; it is
  available to any future extension that wants to exit the agent loop
  gracefully after a completed turn.
- **sf-llm-gateway-internal: unified one-provider, one-`/login`-row design
  with paste-token flow.** Previously the gateway registered two pi
  providers (`sf-llm-gateway-internal` for GPT/Gemini/Codex and
  `sf-llm-gateway-internal-anthropic` for Claude) so pi's `/login` menu
  showed two rows for the same gateway and the same token, which was
  confusing. Now there is a single provider `sf-llm-gateway-internal`
  displayed as "SF LLM Gateway (Salesforce Internal)". All models inherit
  the provider-level `openai-completions` API so pi always invokes the
  provider's custom `streamSimple`; the dispatcher detects Claude model ids
  and forwards them to the native Anthropic transport (same streamer as
  before, with a one-line `model.baseUrl` rewrite to the gateway root). A
  new `oauth.onPrompt` block wires
  `/login` to a one-shot paste-token flow that saves to the global saved
  config, so new users can authenticate without leaving pi.

  Backward compatibility: a one-shot settings migration rewrites any
  residual references to the retired `sf-llm-gateway-internal-anthropic`
  id in the user's global and project pi `settings.json`
  (`defaultProvider`, `defaultModel`, `enabledModels`). Idempotent via a
  `sfPi.gatewayUnifyMigrated` sentinel, so the migrator runs at most once
  per settings file. Env-var users (`SF_LLM_GATEWAY_INTERNAL_API_KEY`) and
  existing saved-config users are not affected. Current sf-pi builds require
  pi `>=0.73.0`; see the breaking-change note above.

- **sf-devbar: instant thinking-badge repaint on `thinking_level_select`
  (pi ≥ 0.71).** pi emits `thinking_level_select` whenever the user flips
  thinking level via shortcut, settings, or model clamp. Previously the
  devbar only refreshed the rainbow badge on the next turn boundary,
  leaving it visibly stale while idle. Current sf-pi builds require pi
  `>=0.73.0`; see the breaking-change note above.

### Features

- **`scripts/check-panel-consistency.mjs` enforces the panel contract.**
  New lint script that walks `catalog/index.json` and asserts every
  command-bearing extension imports `openCommandPanel`,
  `openInfoPanel`, and the shared lifecycle-toggle helper. Wired into
  `npm run validate` (between Type check and Tests) and exposed as
  `npm run check:panels` for ad-hoc runs. sf-lsp is documented as an
  exempt extension (its rich Doctor + Recent activity layout is
  intentional); sf-pi-manager / sf-brain / sf-ohana-spinner are exempt
  for the obvious structural reasons.
- **`scripts/scaffold.mjs` produces a ready-to-extend command panel.**
  Running `npm run scaffold -- --id sf-foo --category core --name 'SF
  Foo'` now generates an index.ts that already imports the shared
  panel + info-panel + lifecycle-toggle helpers, registers a
  `/sf-foo` command, opens a panel with Show status / Show help /
  Close / Disable this extension actions, and routes results through
  `openInfoPanel`. New extensions pass the panel-consistency lint
  immediately.
- **Drift migrations: sf-lsp, sf-llm-gateway-internal, and sf-welcome
  adopt the standardized panel + popup pattern.**
  - `/sf-lsp` keeps its rich Doctor + Recent activity panel but its
    section labels now use the shared `toolTitle` color, every action
    result (`Refresh doctor`, `Toggle verbose`, `Shut down LSP
    servers`, ...) routes through `openInfoPanel` instead of dumping a
    `notify` line, and a `Disable this extension` row joins the
    actions list under a Lifecycle group.
  - `/sf-llm-gateway-internal` was already using the shared command
    panel; the lifecycle toggle row is now appended automatically.
  - `/sf-welcome` now opens a standardized command panel with `Show
    splash summary`, `Install bundled Nerd Font`, `Show help`, `Close`,
    and `Disable this extension` actions. Direct invocations
    (`/sf-welcome summary`) and headless mode keep their plain-text
    output for `pi -p` callers and shell scripts.
- **Lifecycle toggle action: every per-extension settings panel can
  enable/disable the extension without leaving the panel.** A new
  `extensions/sf-pi-manager/lib/extension-toggle.ts` exports
  `buildToggleExtensionAction` (a `CommandPanelAction` row whose label
  flips between "Disable this extension" and "Enable this extension"
  based on current state) and `performToggleExtension` (writes the
  filter, reloads). Wired into sf-slack, sf-devbar, sf-guardrail,
  sf-skills-hud, sf-feedback, sf-agentscript-assist, and sf-data360.
  `alwaysActive` extensions (sf-pi-manager, sf-brain) hide the toggle
  row, so the helper is safe to call unconditionally. The new shared
  group is `Lifecycle` (also where Close lives), giving every panel one
  predictable place for both the close action and the toggle.
- **sf-data360: panel actions now render in a popup (`openInfoPanel`)
  instead of a chat-line notify.** When `/sf-data360` is invoked from
  the settings panel, action results (`Show status`, `Show help`)
  surface in the same overlay surface used by sf-slack, sf-devbar, and
  the rest of the suite. Direct command-line invocations and headless
  mode keep their previous behavior.
- **Shared command panel: distinct color hierarchy + `exit`/`quit` close
  keywords.** Every `/sf-*` panel rendered through
  `lib/common/command-panel.ts` previously painted the panel title,
  section headings (`STATUS`, `ACTIONS`), group labels (`DIAGNOSTICS`,
  `LIFECYCLE`, ...), and the `SELECTED` callout in the same `accent`
  theme token, which collapsed four distinct hierarchy levels onto one
  color. The panel now uses a four-step ladder — `accent` (title) >
  `toolTitle` (section heading + selected callout) > `muted` bold (group
  labels) > `text` (rows) — so every theme distinguishes the levels
  visibly without needing custom colors. `lib/common/info-panel.ts`
  borders/title still use `borderAccent`/`accent` so it reads as a
  distinct popup over the panel.
- **Shared command and info panels: typing `exit` or `quit` closes the
  popup.** Users reach for those keywords by muscle memory before
  remembering Esc, but pi's stock TUIs ignore them. Both panels now
  track typed keystrokes in a small ring buffer and dismiss the popup
  the moment the buffer matches a registered close keyword. Esc / `q` /
  Enter (info-panel) still work; partial filter prefixes that happen to
  start with `e`, `q`, `ex`, ... still filter normally. Help footers
  updated to mention the keyword.
- **sf-data360: standardized `/sf-data360` settings panel.** `/sf-data360`
  with no args used to dump a status notification, while every other
  bundled extension (`/sf-slack`, `/sf-devbar`, `/sf-guardrail`,
  `/sf-llm-gateway-internal`, `/sf-skills-hud`, `/sf-agentscript-assist`)
  opened a grouped command panel via `lib/common/command-panel.ts`. The
  Data 360 command now opens the same standardized panel — status
  block plus Show status / Show help / Close actions — so the suite has
  one consistent settings UX. Headless callers and explicit subcommands
  (`/sf-data360 status`, `/sf-data360 help`) continue to print plain
  text. The existing in-overlay drill-down panel
  (`lib/config-panel.ts`) is unchanged.

### Bug Fixes

- **sf-llm-gateway-internal: preserve explicit gateway model allow-lists
  across restarts (#163).** Startup now registers the previous local model
  discovery cache immediately after the bootstrap catalog, before Pi resolves
  `enabledModels`, so scoped model lists can include discovered gateway models
  on first paint. The settings repair step also keeps user-authored
  `sf-llm-gateway-internal/<model-id>` entries instead of rewriting them to
  the provider wildcard; only entries from the retired Anthropic-only provider
  are normalized.
- **sf-pi-manager: auto-detect scope for `/sf-pi` commands so a project-only
  install of sf-pi works without typing `project` on every command
  (#88).** `parseCommandArgs` previously hardcoded the default scope to
  `global`, so `/sf-pi`, `/sf-pi disable <id>`, and friends would
  short-circuit with "sf-pi package not found in global settings" when
  the package was installed only in `.pi/settings.json`. The dispatcher
  now resolves the scope at runtime via `resolveEffectiveScope(cwd)`
  (project beats global, mirroring Pi's own settings precedence) when the
  user does not pass an explicit `global`/`project` token. Explicit
  scope tokens still win, and the overlay's `S`-key toggle is unchanged.
  When the package is in the *other* scope, the warning now points the
  user at the right scope instead of asking them to reinstall.
- **sf-llm-gateway-internal: keep Claude requests on the unified dispatcher.**
  Claude models no longer pass `api: "anthropic-messages"` into pi's model
  registry because that made pi bypass the provider-level `streamSimple`
  dispatcher and call the built-in Anthropic transport with the provider's
  OpenAI base URL, producing `<gateway>/v1/v1/messages`. Claude is now
  detected by model id inside the dispatcher, which rewrites the base URL to
  the gateway root before calling the Anthropic-native shim.
- **sf-llm-gateway-internal: don't create project `.pi/settings.json` for a
  no-op migration.** Missing project settings cannot contain legacy provider
  references, so the migration now skips them instead of stamping a sentinel
  file into every repo a user opens.

### Notes

- **pi 0.71+ session storage note.** pi 0.71 removed built-in Google Gemini
  CLI and Antigravity providers; sf-pi does not use either. The README also
  documents `PI_CODING_AGENT_SESSION_DIR` for users who want to relocate
  session storage. Current sf-pi builds require pi `>=0.73.0`; see the
  breaking-change note above.

- **sf-welcome + sf-pi-manager: announcements panel and update nudge.**
  sf-pi now surfaces maintainer announcements and a non-intrusive
  "update available" nudge on the splash. Content comes from three
  layered sources: a bundled `catalog/announcements.json` that ships
  with the release (zero network, always works offline), an optional
  hosted JSON feed merged in on top when network is available
  (configurable via the manifest's `feedUrl`, 1.5s timeout, ETag-aware,
  24h cache, silent-fail), and a synthetic update entry generated at
  runtime when the installed version is behind the manifest's
  `latestVersion` (with highlights sourced from the local
  `CHANGELOG.md`). The splash renders a dedicated Announcements panel
  at the top of the right column (max 3 items, capped to one line
  each); the footer shows a `/sf-pi announcements` nudge until the
  user either dismisses the splash or lists items explicitly.
  Dismissals are sticky across manifest revisions — once an id is
  hidden, bumping `revision` never resurfaces it. Opt-out via
  `SF_PI_ANNOUNCEMENTS=off` or `{ "sfPi": { "announcements": false } }`;
  opt out of the remote feed only via `SF_PI_ANNOUNCEMENTS_FEED=off`
  or `{ "sfPi": { "announcements": { "feedEnabled": false } } }`. New command:
  `/sf-pi announcements [list|dismiss <id>|reset]`. State lives in
  `~/.pi/agent/state/sf-pi/announcements.json`. Schema + latestVersion
  shape are validated at `npm run generate-catalog` time so a broken
  manifest can't ship.

- **sf-pi-manager: recommended external extensions.** sf-pi now ships a
  curated list of open-source pi extensions it _recommends_ (does not
  redistribute) at `catalog/recommendations.json`. A new `/sf-pi
  recommended` subcommand opens an interactive checklist; `install`,
  `remove`, `list`, and `status` sub-subcommands are also available.
  On `session_start`, if the manifest's `revision` differs from what the
  user has acknowledged and at least one default-bundle item is still
  pending, a one-line nudge appears in the footer status bar — nothing
  installs automatically. Decisions are sticky across sessions:
  installed and declined items are never re-prompted. Opt-out via
  `SF_PI_RECOMMENDATIONS=off`. License allow-list (`MIT`, `Apache-2.0`,
  `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`) is enforced at catalog
  generation time so new entries can't silently broaden the set. Default
  bundle seed: `pi-skills`, `pi-web-access`, `pi-aliases`, `pi-interview`,
  `glimpseui`, `pi-tool-display`, `pi-updater`.

- **sf-slack: human-in-the-loop recipient resolution as a first-class
  primitive.** Every fuzzy channel or user reference now flows through a
  single shared helper (`requireConfirmedChannel` /
  `requireConfirmedUser` in `lib/recipient-confirm.ts`) that unifies the
  previously-scattered resolution logic across `slack`, `slack_channel`,
  `slack_file`, `slack_user`, `slack_send`, and `slack_research`. The
  helper enforces a single 0.85 auto-confirm threshold (was a mix of
  0.60 permissive reads vs 0.85 strict writes), pops an interactive
  select dialog below threshold, **always** offers a "Type exact
  name/ID instead" option so the user can retype an ambiguous ref
  instead of being forced to pick from imperfect candidates, loops the
  type-exact retry indefinitely until the user cancels or a confident
  match is found, and fails loudly in headless mode with the full
  candidate list in the error instead of auto-picking below threshold.
  Nets ~160 LOC removed from call sites (six ad-hoc `resolveChannelParam`
  / `resolveUserParam` variants replaced by a single helper call each).

### Bug Fixes

- **sf-slack: ghost channel IDs no longer survive resolution.** Live
  chaos test found that `slack_resolve type=channel text=C09ZZZZZZZZ`
  (any syntactically valid but unverifiable channel ID) returned a
  0.75-confidence fabricated "best match", which then passed the
  permissive 0.60 threshold used by `slack` / `slack_channel` /
  `slack_file` and silently routed downstream tool calls to the ghost
  ID. Fix: `resolveChannelById()` returns `undefined` when
  `conversations.info` fails (for any reason), and the caller pushes a
  warning explaining the ID couldn't be verified. Combined with the
  HITL migration, low-confidence ghost IDs now produce a select-or-
  type dialog in interactive mode and a loud failure in headless mode.
- **sf-slack: broadcast re-confirm now catches user-group pings.**
  `<!subteam^S.../@group>` mentions previously bypassed the `@channel`
  / `@here` / `@everyone` warning dialog — user groups can ping large
  teams so the blast radius matches. `MENTION_PATTERN` gains
  `<!subteam\b`. Runtime regex test locks it in.

### Bug Fixes (follow-up to v0.14.0 slack_send)

- **sf-slack: action-aware `slack_send` preflight.** Previously
  `preflightSend()` only checked `chat:write`, so `action=dm` on a token
  without `im:write` would resolve the recipient, pop the confirm
  dialog, and then fail at `conversations.open` with a noisy
  multi-scope `missing_scope` (listing all four `*:write` scopes in
  `needed`). The preflight now takes the action and gates `dm` against
  `im:write` upfront with a single-line, actionable error that names
  `im:write` specifically and suggests using an existing `D...` channel
  ID via `action=channel` as an alternative. Channel and thread paths
  still only require `chat:write` so the DM-only gate doesn't leak into
  non-DM flows. MPIM-only gating is deliberately left to runtime error
  normalization to avoid an extra `conversations.info` round-trip on
  every send.
- **sf-slack: `slack_canvas` read fallback error decoding.** When
  `files.info` failed with `missing_scope` on a `files:read`-less token
  and the `canvases.sections.lookup` fallback also failed, the code
  previously reported "lacks both files:read and canvases:read"
  regardless of the second error — misleading when the real cause was
  `file_not_found` from an invalid canvas ID. The fallback branch now
  inspects the second error and routes it appropriately:
  `file_not_found`/`channel_not_found` produces a clear "canvas not
  found" message, genuine double-`missing_scope` keeps the scope-
  missing copy, and anything else flows through the normalized error
  helper.
- **sf-slack: `slack_send` raw channel ID now resolves to `#name`.**
  When the user passed a channel ID directly (e.g. `slack_send
  action=channel to=C01ABC123 ...`) the synchronous channel-name
  cache was sometimes cold, so both the confirm-dialog preview and the
  result header displayed the bare ID instead of `#channel-name`. The
  raw-ID branch in `routeRecipient()` now falls back to the async
  `resolveChannelName()` helper (wrapped in a try/catch so a resolver
  failure never blocks the send). Cosmetic fix; no behavior change
  beyond the label.

### Features

- **sf-slack: `slack_send` — human-in-the-loop messaging.** New tool to post
  Slack messages with an always-on confirmation dialog. Three actions:
  `channel` (public/private/MPIM), `dm` (1:1, via `conversations.open`), and
  `thread` (reply with `thread_ts`). Every send routes through
  `ctx.ui.confirm()` with a 60-second auto-cancel; fuzzy recipients below
  0.85 confidence force an explicit pick via `ctx.ui.select()`; messages
  containing `@channel` / `@here` / `@everyone` trigger a second confirm
  with Cancel as the default. Non-interactive sessions (`pi -p`, RPC, CI)
  refuse to send unless `SLACK_ALLOW_HEADLESS_SEND=1` is set. A
  `SLACK_SEND_DRY_RUN=1` env var runs the full UX plus an audit entry but
  skips the API call, for safe demos and local testing. Every send (real
  or dry-run) appends a typed audit entry to the session branch; list
  recent activity with `/sf-slack sent`.
- **sf-slack: scope set** for sending. `DEFAULT_SCOPES` now requests
  `chat:write`, `chat:write.public`, `im:write`, and `mpim:write` alongside
  the existing read scopes. The scope probe gates `slack_send` off when
  neither `chat:write` nor `chat:write.public` is granted, so tokens that
  don't re-consent keep the full read experience but silently drop the
  write surface.

### Bug Fixes

- **sf-slack: auth status no longer lies about scopes.**
  `buildAuthStatus()` (shown by `/sf-slack`) now renders *granted* scopes
  read from Slack's `X-OAuth-Scopes` response header, alongside the
  *requested* list from `DEFAULT_SCOPES` / `SLACK_SCOPES`. A ⚠ line
  lists requested-but-not-granted scopes so drift is obvious at a glance.
  The footer status line also shows `⚠ N requested scopes not granted`
  when drift exists, and `/sf-slack refresh` notifies inline.
- **sf-slack: scope probe is now header-driven.** Replaced the
  synthetic-call probe (two fake API calls to `conversations.info` and
  `files.list` looking for `missing_scope`) with a single `auth.test`
  that reads `X-OAuth-Scopes` and gates tools by explicit any-of scope
  requirements. Covers every scope Slack recognizes, not just two, and
  avoids false positives when the synthetic calls fail for unrelated
  reasons. Exposes pure `computeGatedTools` and
  `computeMissingGrantedScopes` helpers for testability.
- **sf-slack: `slack_canvas` per-action preflight.** Canvas `create`/`edit`
  now rejects bot/app tokens upfront with a clear "needs a user token
  (xoxp-)" message instead of relaying Slack's raw `bot_scopes_not_found`.
  Missing `canvases:write` gets a precise re-consent hint. The
  `action:read` fallback that used to say "metadata unavailable" now
  explains *why* ("token lacks files:read" or "files.info call was denied
  by Slack") so users aren't left guessing.
- **sf-slack: DMs + MPIMs no longer silently dropped from search.** All
  `assistant.search.context` call sites now pass
  `channel_types=public_channel,private_channel,mpim,im` via a new
  `DEFAULT_ASSISTANT_CHANNEL_TYPES` constant. Slack's default excluded
  DMs and multi-party IMs from results, which was never what a user
  searching their own workspace wanted. A source-level test locks the
  default in place across all five call sites
  (`tools.ts`, `research-tool.ts`, `channel-tool.ts`, `resolve.ts`,
  `api.ts`).
- **sf-slack: clearer error messages** for `bot_scopes_not_found`,
  `not_allowed_token_type`, `token_expired`, `not_in_channel`,
  `is_archived`, `msg_too_long`, `no_text`, and `cannot_dm_bot`, plus a
  re-consent hint on `missing_scope`.
- **sf-slack: `DEFAULT_SCOPES` uses the granular search family.** Replaced
  the coarse legacy `search:read` with the granular `search:read.{public,
  private, im, mpim, files, users}` scopes, which some workspaces approve
  while refusing the legacy form. The scope probe still accepts either,
  so existing tokens continue to work.
- **sf-slack: X-OAuth-Scopes header capture.** `slackApi()` and
  `slackApiJson()` now populate a module-level granted-scope cache from
  every response, and `detectTokenType()` classifies tokens by prefix
  (`xoxp-` → user, `xoxb-` → bot, `xoxa-`/`xapp-` → app). Both feed the
  scope probe, auth-status rendering, and the `slack_canvas` /
  `slack_send` preflights.

### Repo Simplification

- Added agent-first quick-reference ("Where does X live?") to `ARCHITECTURE.md`
  and a "Scripts reference" table to `CONTRIBUTING.md`.
- `catalog/index.json` now includes a `srcLoc` field per extension so agents
  can quickly gauge extension size.
- Added per-extension `AGENTS.md` for the three most complex extensions
  (`sf-plan`, `sf-slack`, `sf-llm-gateway-internal`) with prescriptive rules,
  file maps, and closure-state conventions.
- Folded `MAINTAINERS.md` into `GOVERNANCE.md` and deleted shipped proposals
  under `proposals/` (captured in git history + CHANGELOG).
- Moved `lib/common/display/render.ts` into `sf-pi-manager` (its sole
  consumer) to reduce shared-lib noise.
- Removed the deprecated `createGatewayConfigPanel` alias in
  `sf-llm-gateway-internal`.

### Refactors

- **sf-welcome ↔ sf-llm-gateway-internal decoupling**: monthly-usage state now
  lives in `lib/common/monthly-usage/store.ts`. The gateway registers a
  refresher at `session_start`; sf-welcome reads the shared snapshot. This
  restores the "disabled extensions have zero runtime cost" contract —
  sf-welcome no longer imports from the gateway's internals.
- **sf-llm-gateway-internal:** extracted Anthropic beta header controls into
  `lib/beta-controls.ts` (-159 LOC from `index.ts`). Behavior unchanged.

### Bug Fixes

- **sf-llm-gateway-internal:** reduce intermittent Anthropic `api_error` ("Internal
  server error") on Opus 4.7 by shrinking the heavy-workload request profile
  and retrying transient mid-stream failures before they reach the user.
  Four coordinated fixes (addresses #39):
  - Stop silently forcing `thinkingLevel: xhigh` on every `model_select`.
    `xhigh` is still the recommended default for fresh sessions, but user
    overrides via `/thinking` are now respected on subsequent model switches.
  - Scale the Opus 4.7 `max_tokens` floor by pi reasoning level
    (minimal=16K, low=24K, medium=32K, high=48K, xhigh=64K) instead of
    unconditionally flooring every request at 64K. Low-effort turns no longer
    inherit the xhigh output profile.
  - Always include `fine-grained-tool-streaming-2025-05-14` in the
    `anthropic-beta` header so pi-ai's `Object.assign`-based header merge
    does not silently drop it when we attach `context-1m-2025-08-07`.
  - Widen the transparent inner-stream retry from 1 attempt to 3 with
    exponential backoff and let it cover `start` + `thinking_*` events
    (previously only `start`), so transient Anthropic 500s that arrive
    after thinking begins can still be recovered without bubbling a raw
    JSON error envelope to the TUI.
- **sf-llm-gateway-internal:** surface inner-stream retry state to the UI and
  append actionable guidance to final upstream errors (rounds out #39):
  - When the transparent retry kicks in, show `Gateway upstream hiccup —
    retrying (n/N) in Xs. <reason>` so users can tell a hiccup apart from
    slow streaming. When it succeeds, show `recovered after N attempts`.
    When it exhausts, show a single-line summary including a `Tip:` with
    `~/.pi/agent/settings.json`, `/compact`, and the Anthropic status URL.
  - The final sanitized error forwarded downstream now carries the same
    `Tip:` footer inline so users see actionable next steps even when pi's
    outer retry renders the error itself.

## [0.209.1](https://github.com/salesforce/sf-pi/compare/v0.209.0...v0.209.1) (2026-06-24)


### Bug Fixes

* avoid recycled herdr lane aliases ([afee3ed](https://github.com/salesforce/sf-pi/commit/afee3ed6387a248c77affeaa0ae3fef9e98b0362))

## [0.209.0](https://github.com/salesforce/sf-pi/compare/v0.208.0...v0.209.0) (2026-06-24)


### Features

* refine sf-herdr fresh lane planning ([931fa01](https://github.com/salesforce/sf-pi/commit/931fa01219d1e3d5f3f8c4fafdffb48c37b51e88))

## [0.208.0](https://github.com/salesforce/sf-pi/compare/v0.207.0...v0.208.0) (2026-06-24)


### Features

* improve Data 360 readiness and journey progress ([50ded1f](https://github.com/salesforce/sf-pi/commit/50ded1f63d4439a1878c92036c6b1fd480068d2e))

## [0.207.0](https://github.com/salesforce/sf-pi/compare/v0.206.3...v0.207.0) (2026-06-24)


### Features

* add Data 360 run digest presentation ([d01f809](https://github.com/salesforce/sf-pi/commit/d01f8092b0c8f3e303b09d2d662ad55c07a7f27a))

## [0.206.3](https://github.com/salesforce/sf-pi/compare/v0.206.2...v0.206.3) (2026-06-24)


### Bug Fixes

* harden sf-data360 observability tools ([940c6f0](https://github.com/salesforce/sf-pi/commit/940c6f0b5e36a4f92c992e8c22ccd9147d1badb0))

## [0.206.2](https://github.com/salesforce/sf-pi/compare/v0.206.1...v0.206.2) (2026-06-24)


### Bug Fixes

* require pi 0.80.2 runtime ([b122444](https://github.com/salesforce/sf-pi/commit/b122444f6a7a7f1832a0fab2e84a70f407303e36))

## [0.206.1](https://github.com/salesforce/sf-pi/compare/v0.206.0...v0.206.1) (2026-06-23)


### Bug Fixes

* **sf-docs:** normalize html fetch previews ([e416ef6](https://github.com/salesforce/sf-pi/commit/e416ef600c8e2e463ab92cd8f5a4d04fb229870e))

## [0.206.0](https://github.com/salesforce/sf-pi/compare/v0.205.1...v0.206.0) (2026-06-23)


### Features

* **sf-docs:** improve docs result rendering ([a4000aa](https://github.com/salesforce/sf-pi/commit/a4000aa5be1ba8ede87d8ccbfff1ad75c4ec9f48))


### Bug Fixes

* **sf-docs:** harden explain and evidence URLs ([4c3adde](https://github.com/salesforce/sf-pi/commit/4c3addea7d77ae84776165367e3006fd9f24bd02))

## [0.205.1](https://github.com/salesforce/sf-pi/compare/v0.205.0...v0.205.1) (2026-06-23)


### Bug Fixes

* **sf-docs:** allow explain by document only ([dabeaa6](https://github.com/salesforce/sf-pi/commit/dabeaa6229bdfc4345982240cc1d0ad54abf5cbd))
* **sf-docs:** include search results in tool content ([3f7f77f](https://github.com/salesforce/sf-pi/commit/3f7f77f4035bb5fe196ee06b762c7d51e989fea0))

## [0.205.0](https://github.com/salesforce/sf-pi/compare/v0.204.4...v0.205.0) (2026-06-23)


### Features

* add sf-docs extension ([f8cced6](https://github.com/salesforce/sf-pi/commit/f8cced6543ad3becd6f8fedf67fd920aff314086))

## [0.204.4](https://github.com/salesforce/sf-pi/compare/v0.204.3...v0.204.4) (2026-06-22)


### Bug Fixes

* **ui:** keep manager overlay anchor stable ([02995ed](https://github.com/salesforce/sf-pi/commit/02995ed1802ede921e3af316394892f951fbeaa1))

## [0.204.3](https://github.com/salesforce/sf-pi/compare/v0.204.2...v0.204.3) (2026-06-22)


### Bug Fixes

* **ui:** keep manager detail actions in viewport ([ac70fed](https://github.com/salesforce/sf-pi/commit/ac70fed2bb76f0767fe7c75230f81689ca4900e8))

## [0.204.2](https://github.com/salesforce/sf-pi/compare/v0.204.1...v0.204.2) (2026-06-22)


### Bug Fixes

* **sf-lsp:** show doctor output in info panel ([3badbed](https://github.com/salesforce/sf-pi/commit/3badbed00224b18e000b5e590307f4f083a2c9cd))
* **sf-welcome:** register manager actions after initialization ([8547994](https://github.com/salesforce/sf-pi/commit/85479947808fd1df3a337c81765457ed7834e32d))
* **ui:** route legacy slash panels through manager ([d1b66da](https://github.com/salesforce/sf-pi/commit/d1b66da22c1039451194eee9cc0a85040571e08d))

## [0.204.1](https://github.com/salesforce/sf-pi/compare/v0.204.0...v0.204.1) (2026-06-22)


### Bug Fixes

* **ui:** make manager and info panels scrollable ([277f675](https://github.com/salesforce/sf-pi/commit/277f6759f808fa7491f1672f53e6a1c2da48813b))

## [0.204.0](https://github.com/salesforce/sf-pi/compare/v0.203.0...v0.204.0) (2026-06-22)


### Features

* **settings:** add agentscript brain and feedback preferences ([3d2eebd](https://github.com/salesforce/sf-pi/commit/3d2eebd607583a361e5d9c745e3f5733bc3ee60e))

## [0.203.0](https://github.com/salesforce/sf-pi/compare/v0.202.0...v0.203.0) (2026-06-22)


### Features

* **settings:** add skills and browser manager preferences ([6a40631](https://github.com/salesforce/sf-pi/commit/6a40631a76328dcad67d297703cccbc3acc202b3))

## [0.202.0](https://github.com/salesforce/sf-pi/compare/v0.201.0...v0.202.0) (2026-06-22)


### Features

* **settings:** add lsp welcome and explorer manager preferences ([cc00082](https://github.com/salesforce/sf-pi/commit/cc000827695c77ab0519769fb3b917b728465dce))

## [0.201.0](https://github.com/salesforce/sf-pi/compare/v0.200.0...v0.201.0) (2026-06-22)


### Features

* **settings:** add data360 and herdr manager preferences ([c925c09](https://github.com/salesforce/sf-pi/commit/c925c090217db98321506437b94886ceeae3f45b))

## [0.200.0](https://github.com/salesforce/sf-pi/compare/v0.199.0...v0.200.0) (2026-06-22)


### Features

* **settings:** add analyzer and spinner manager preferences ([fb15fed](https://github.com/salesforce/sf-pi/commit/fb15fede33191a788b0badb68b741442dc053b60))

## [0.199.0](https://github.com/salesforce/sf-pi/compare/v0.198.2...v0.199.0) (2026-06-22)


### Features

* **sf-slack:** move preferences into manager settings ([c00e8f9](https://github.com/salesforce/sf-pi/commit/c00e8f947462bfbf5dfe14e401db120680976eea))

## [0.198.2](https://github.com/salesforce/sf-pi/compare/v0.198.1...v0.198.2) (2026-06-22)


### Bug Fixes

* **sf-devbar:** save color settings in place ([3e28dd6](https://github.com/salesforce/sf-pi/commit/3e28dd6471fa4951f9082fae9e2dd21af386648e))

## [0.198.1](https://github.com/salesforce/sf-pi/compare/v0.198.0...v0.198.1) (2026-06-22)


### Bug Fixes

* **sf-pi-manager:** keep display settings open on save ([2e5c73f](https://github.com/salesforce/sf-pi/commit/2e5c73f42b5e1963243a0fb5641e539c398d9096))

## [0.198.0](https://github.com/salesforce/sf-pi/compare/v0.197.0...v0.198.0) (2026-06-22)


### Features

* **sf-llm-gateway:** standardize manager setup settings ([366066b](https://github.com/salesforce/sf-pi/commit/366066b724c9f600d2d0d4d3e5d0c90244fbbe69))

## [0.197.0](https://github.com/salesforce/sf-pi/compare/v0.196.7...v0.197.0) (2026-06-22)


### Features

* require pi 0.79.10 runtime ([170a246](https://github.com/salesforce/sf-pi/commit/170a246dcc0fc27174bf88e30ddc227920af7b8a))

## [0.196.7](https://github.com/salesforce/sf-pi/compare/v0.196.6...v0.196.7) (2026-06-22)


### Bug Fixes

* **sf-agentscript:** bound lifecycle deploy operations ([6ed6ad4](https://github.com/salesforce/sf-pi/commit/6ed6ad414e2d310a5abaf1fe4edc229b5dbd04f2))

## [0.196.6](https://github.com/salesforce/sf-pi/compare/v0.196.5...v0.196.6) (2026-06-22)


### Bug Fixes

* **sf-agentscript:** bound eval identity and batch timeouts ([a4210b1](https://github.com/salesforce/sf-pi/commit/a4210b1345e128a7d3b35e489c0b6b92d49d33b9))

## [0.196.5](https://github.com/salesforce/sf-pi/compare/v0.196.4...v0.196.5) (2026-06-21)


### Bug Fixes

* **sf-agentscript:** bound remaining org readiness probes ([18f0aae](https://github.com/salesforce/sf-pi/commit/18f0aaeaccc2888871701c4fdf9442325f1e8107))

## [0.196.4](https://github.com/salesforce/sf-pi/compare/v0.196.3...v0.196.4) (2026-06-21)


### Bug Fixes

* **sf-agentscript:** bound runtime smoke queries ([afa0325](https://github.com/salesforce/sf-pi/commit/afa0325a82c116b3efa1bcfbba0e329bf09d2579))

## [0.196.3](https://github.com/salesforce/sf-pi/compare/v0.196.2...v0.196.3) (2026-06-21)


### Bug Fixes

* **sf-agentscript:** bound review org readiness checks ([41f28da](https://github.com/salesforce/sf-pi/commit/41f28da547264987bdd5e8a2d605f3cf42dd368e))

## [0.196.2](https://github.com/salesforce/sf-pi/compare/v0.196.1...v0.196.2) (2026-06-21)


### Bug Fixes

* **sf-agentscript:** harden Salesforce transport ([a67e803](https://github.com/salesforce/sf-pi/commit/a67e80393b3c439bb626880ea321f74d3a41e17a))

## [0.196.1](https://github.com/salesforce/sf-pi/compare/v0.196.0...v0.196.1) (2026-06-21)


### Bug Fixes

* defer pi-ai base imports ([204a26c](https://github.com/salesforce/sf-pi/commit/204a26cf1f8b3f64819090f336b07302d7a86510))

## [0.196.0](https://github.com/salesforce/sf-pi/compare/v0.195.0...v0.196.0) (2026-06-21)


### Features

* require pi runtime 0.79.9 ([999d186](https://github.com/salesforce/sf-pi/commit/999d1867edcdc64f435bd459ce293ffa87c139bf))
* **sf-pi-manager:** add scoped manager actions ([add56c8](https://github.com/salesforce/sf-pi/commit/add56c8f81f62f0035765a8363977780e1a60dd8))

## [0.195.0](https://github.com/salesforce/sf-pi/compare/v0.194.5...v0.195.0) (2026-06-19)


### Features

* **sf-agentscript:** route command to manager ([91c5b36](https://github.com/salesforce/sf-pi/commit/91c5b367144cb040d17c3afeeb4421ec77be6365))
* **sf-browser:** route command to manager ([a433609](https://github.com/salesforce/sf-pi/commit/a43360949597efe5a006d486f39948834e9c2f9b))
* **sf-code-analyzer:** route command to manager ([091c00f](https://github.com/salesforce/sf-pi/commit/091c00f2b752134653b95b0f7660b5b0e71c593b))
* **sf-data360:** route command to manager ([0c14b18](https://github.com/salesforce/sf-pi/commit/0c14b18128ae7f4abbb1010956b2e431b89b961d))
* **sf-feedback:** drill manager actions into wizard ([edc2442](https://github.com/salesforce/sf-pi/commit/edc24423d5e49b08873a354a6f734ef93a05b844))
* **sf-feedback:** use native field editor ([44cfe37](https://github.com/salesforce/sf-pi/commit/44cfe377b7a91a5974639d0a1aa2f93c2add2a53))
* **sf-llm-gateway:** route command to manager ([36273b1](https://github.com/salesforce/sf-pi/commit/36273b13678e0cc9ed73e494bd41891a3c7ece6d))
* **sf-pi-manager:** add semantic detail icons ([88b829d](https://github.com/salesforce/sf-pi/commit/88b829d2af5347cd05d0e7aef277ca4af91a2396))
* **sf-pi-manager:** group detail actions ([121a8d9](https://github.com/salesforce/sf-pi/commit/121a8d93bd2f36e32f0ef253ad67e3d3f71aa2bb))
* **sf-pi-manager:** pass tui to action panels ([6180a88](https://github.com/salesforce/sf-pi/commit/6180a88ff4be152c5103ec7547cceb3cc0aa4d7e))
* **sf-slack:** route command to manager ([9859c2e](https://github.com/salesforce/sf-pi/commit/9859c2eea9ba92cff60fe8c330b8a8901b391348))
* **sf-slack:** route command to manager ([d925cd9](https://github.com/salesforce/sf-pi/commit/d925cd9ad5b1a278537cd18c019275412267b816))


### Bug Fixes

* **sf-data-explorer:** close manager before launch ([9ba1589](https://github.com/salesforce/sf-pi/commit/9ba15899a6367103bf82eb073e590448402862f2))
* **sf-data-explorer:** show help in manager page ([2457fb9](https://github.com/salesforce/sf-pi/commit/2457fb9095eae5267749c0c8bd2ede64738f2380))
* **sf-data-explorer:** use standard help popup ([c9e583d](https://github.com/salesforce/sf-pi/commit/c9e583d029e17c5c9f34a90d1631b182edb00ab4))
* **sf-devbar:** support solid gateway badge palettes ([9758da1](https://github.com/salesforce/sf-pi/commit/9758da1ff251749626d410e2ec30446fe3e5b252))
* **sf-feedback:** keep feedback flow in manager page ([b753188](https://github.com/salesforce/sf-pi/commit/b7531888c8e10e8c2fbcb97731b3cc705ee2b6d2))
* **sf-feedback:** simplify manager escape flow ([13949b6](https://github.com/salesforce/sf-pi/commit/13949b60ea045e1a8ba2ff6ab9f4de1cae0d6fdd))
* **sf-feedback:** summarize multiline form values ([d962292](https://github.com/salesforce/sf-pi/commit/d962292ce84718ed84cbe310a197f157d598846f))
* **sf-guardrail:** use manager action pages ([ee14365](https://github.com/salesforce/sf-pi/commit/ee143650fd0b6b2454382d821477e7a6bd93dbb1))
* **sf-pi-manager:** serialize post-close actions ([2012b8c](https://github.com/salesforce/sf-pi/commit/2012b8ce636ed0f27689e6595184a49ff411d844))
* **sf-slack:** keep connect in manager ([a77d991](https://github.com/salesforce/sf-pi/commit/a77d991d0c1b49939b8ec73983903153a04209c0))

## [0.194.5](https://github.com/salesforce/sf-pi/compare/v0.194.4...v0.194.5) (2026-06-18)


### Bug Fixes

* **sf-feedback:** lazy load feedback flow ([34b626f](https://github.com/salesforce/sf-pi/commit/34b626f88f9cfe051bb150efdcc23d8829ddbfaa))

## [0.194.4](https://github.com/salesforce/sf-pi/compare/v0.194.3...v0.194.4) (2026-06-18)


### Bug Fixes

* **sf-herdr:** include extension in pi package ([6354615](https://github.com/salesforce/sf-pi/commit/6354615b267c889f8462f74b91203cb956d4a55a))

## [0.194.3](https://github.com/salesforce/sf-pi/compare/v0.194.2...v0.194.3) (2026-06-18)


### Bug Fixes

* **sf-herdr:** lazy load planner tool ([1c82e70](https://github.com/salesforce/sf-pi/commit/1c82e70160ad9d6adea9ddd833520fd09ea828fc))

## [0.194.2](https://github.com/salesforce/sf-pi/compare/v0.194.1...v0.194.2) (2026-06-18)


### Bug Fixes

* **sf-herdr:** keep settings save in place ([eac37d7](https://github.com/salesforce/sf-pi/commit/eac37d783b824797a708ebb781b5d6d02de55291))

## [0.194.1](https://github.com/salesforce/sf-pi/compare/v0.194.0...v0.194.1) (2026-06-18)


### Bug Fixes

* **sf-herdr:** clarify settings save state ([fb490c8](https://github.com/salesforce/sf-pi/commit/fb490c8a42848170fef970225db53b3ddb67142e))
* **sf-herdr:** remove unused config render width ([deeba47](https://github.com/salesforce/sf-pi/commit/deeba47f09cc3a4641c9f93c9a4f4ae556c22040))

## [0.194.0](https://github.com/salesforce/sf-pi/compare/v0.193.0...v0.194.0) (2026-06-18)


### Features

* **sf-data-explorer:** route command to manager surface ([7639aa7](https://github.com/salesforce/sf-pi/commit/7639aa7a7d0a313da5371f49dca5929946f641af))

## [0.193.0](https://github.com/salesforce/sf-pi/compare/v0.192.1...v0.193.0) (2026-06-18)


### Features

* **sf-herdr:** route command to manager surface ([7901e97](https://github.com/salesforce/sf-pi/commit/7901e974de05a9ad244132697850224777319055))

## [0.192.1](https://github.com/salesforce/sf-pi/compare/v0.192.0...v0.192.1) (2026-06-17)


### Bug Fixes

* align pi runtime mode handling ([45206f4](https://github.com/salesforce/sf-pi/commit/45206f4d3569509b9f1cd29387607493c4406aa8))

## [0.192.0](https://github.com/salesforce/sf-pi/compare/v0.191.5...v0.192.0) (2026-06-17)


### Features

* **agentscript:** inspect newer schema blocks ([d2b3d3e](https://github.com/salesforce/sf-pi/commit/d2b3d3eaf0b30ebbf4774b68a8fb4e88133f5cca))

## [0.191.5](https://github.com/salesforce/sf-pi/compare/v0.191.4...v0.191.5) (2026-06-17)


### Bug Fixes

* **agentscript:** rely on upstream employee default-user lint ([5c7d8aa](https://github.com/salesforce/sf-pi/commit/5c7d8aa1592d0d79284556bfafb359a4f53b658e))

## [0.191.4](https://github.com/salesforce/sf-pi/compare/v0.191.3...v0.191.4) (2026-06-17)


### Bug Fixes

* **agentscript:** use schema-driven scalar mutation ([93d967f](https://github.com/salesforce/sf-pi/commit/93d967fdf2f3e1c3177ff4234e37536f2e4c0bd3))

## [0.191.3](https://github.com/salesforce/sf-pi/compare/v0.191.2...v0.191.3) (2026-06-17)


### Bug Fixes

* **devbar:** stabilize color edit drafts ([b577d06](https://github.com/salesforce/sf-pi/commit/b577d0697835b99e8717ec3130d7c38028c93faa))

## [0.191.2](https://github.com/salesforce/sf-pi/compare/v0.191.1...v0.191.2) (2026-06-16)


### Bug Fixes

* **devbar:** route settings through manager ([a4a76a5](https://github.com/salesforce/sf-pi/commit/a4a76a5b4c38456bf29cf5182d56dd2042cef069))

## [0.191.1](https://github.com/salesforce/sf-pi/compare/v0.191.0...v0.191.1) (2026-06-16)


### Bug Fixes

* **agentscript:** adopt latest AgentScript language ([16f94f2](https://github.com/salesforce/sf-pi/commit/16f94f216317424c0fee6e2d2db7e11a879249d1))

## [0.191.0](https://github.com/salesforce/sf-pi/compare/v0.190.0...v0.191.0) (2026-06-16)


### Features

* **devbar:** add configurable colors ([ae56259](https://github.com/salesforce/sf-pi/commit/ae56259ca008a1ce1ff0c6a499b5c3d9e457913b))


### Bug Fixes

* **devbar:** avoid control regex analyzer findings ([821975a](https://github.com/salesforce/sf-pi/commit/821975af7512cbd89feb5708f06ef604c591d3b0))

## [0.190.0](https://github.com/salesforce/sf-pi/compare/v0.189.3...v0.190.0) (2026-06-15)


### Features

* **agentscript:** cache local analysis snapshots ([44fe1bc](https://github.com/salesforce/sf-pi/commit/44fe1bcf702dcb3c4267e7f88fe930038baa6c02))


### Bug Fixes

* satisfy Data 360 sweep lint findings ([dadc9c0](https://github.com/salesforce/sf-pi/commit/dadc9c0e6c75345b29329b1c05de7033e154de13))

## [0.189.3](https://github.com/salesforce/sf-pi/compare/v0.189.2...v0.189.3) (2026-06-15)


### Bug Fixes

* harden Data 360 PKCE callback handling ([fb27f94](https://github.com/salesforce/sf-pi/commit/fb27f94540faa588ed35c4f0c5c55272ae3a6da4))

## [0.189.2](https://github.com/salesforce/sf-pi/compare/v0.189.1...v0.189.2) (2026-06-15)


### Bug Fixes

* address CodeQL security findings ([14d47e6](https://github.com/salesforce/sf-pi/commit/14d47e66ebbe041e1173f7f80461a229d56d43f4))
* remediate vulnerable dev dependencies ([aacada7](https://github.com/salesforce/sf-pi/commit/aacada795db4075074ebdbce3f4a8a731d149a8e))

## [0.189.1](https://github.com/salesforce/sf-pi/compare/v0.189.0...v0.189.1) (2026-06-15)


### Bug Fixes

* **sf-guardrail:** publish latest guardrail updates ([37f0a3b](https://github.com/salesforce/sf-pi/commit/37f0a3b619dc99c82c2491fc229f715bd39e993c))

## [0.189.0](https://github.com/salesforce/sf-pi/compare/v0.188.0...v0.189.0) (2026-06-15)


### Features

* **sf-guardrail:** guard additional sf cli mutations ([aad0295](https://github.com/salesforce/sf-pi/commit/aad0295579bf2000cb62abcaaa2cbd55d33565fe))

## [0.188.0](https://github.com/salesforce/sf-pi/compare/v0.187.4...v0.188.0) (2026-06-15)


### Features

* **sf-guardrail:** expand dangerous command coverage ([a93ba55](https://github.com/salesforce/sf-pi/commit/a93ba55d7be3000ff607ba018c9324de67e34c99))


### Bug Fixes

* **audit:** override form-data to patched version ([d0acde3](https://github.com/salesforce/sf-pi/commit/d0acde3ef258a6f7b6f07e8bcb1d270963972f4b))

## [0.187.4](https://github.com/salesforce/sf-pi/compare/v0.187.3...v0.187.4) (2026-06-15)


### Bug Fixes

* **sf-pi:** keep manager open for detail actions ([884ea2a](https://github.com/salesforce/sf-pi/commit/884ea2a56e0935a768ca94fed2d404b3739ee522))

## [0.187.3](https://github.com/salesforce/sf-pi/compare/v0.187.2...v0.187.3) (2026-06-15)


### Bug Fixes

* **sf-guardrail:** preserve manager actions after settings ([4f31f2d](https://github.com/salesforce/sf-pi/commit/4f31f2dd172026c7d9ecb24542d770bd7d420c80))

## [0.187.2](https://github.com/salesforce/sf-pi/compare/v0.187.1...v0.187.2) (2026-06-15)


### Bug Fixes

* **sf-pi:** discover manager actions via event bus ([27bd27e](https://github.com/salesforce/sf-pi/commit/27bd27e0eae0a41a037d169dc8ea98adce082350))

## [0.187.1](https://github.com/salesforce/sf-pi/compare/v0.187.0...v0.187.1) (2026-06-15)


### Bug Fixes

* **sf-guardrail:** open manager directly from command ([2f6d7a2](https://github.com/salesforce/sf-pi/commit/2f6d7a24beaa3ae15f068d7d233724b98961a442))

## [0.187.0](https://github.com/salesforce/sf-pi/compare/v0.186.0...v0.187.0) (2026-06-15)


### Features

* **sf-pi:** deep link extension commands to manager ([264b2f7](https://github.com/salesforce/sf-pi/commit/264b2f7eaf54b3a78da61f894bd0482a27a0e064))

## [0.186.0](https://github.com/salesforce/sf-pi/compare/v0.185.0...v0.186.0) (2026-06-15)


### Features

* **sf-guardrail:** add nested settings navigation ([f1c0f03](https://github.com/salesforce/sf-pi/commit/f1c0f0356b29cf99a480225e70e6bf8b7ea08a9d))

## [0.185.0](https://github.com/salesforce/sf-pi/compare/v0.184.6...v0.185.0) (2026-06-15)


### Features

* **sf-guardrail:** move preferences to Pi settings ([19b6227](https://github.com/salesforce/sf-pi/commit/19b6227ca4f476438fc23796736757dd57614b23))

## [0.184.6](https://github.com/salesforce/sf-pi/compare/v0.184.5...v0.184.6) (2026-06-15)


### Bug Fixes

* **sf-guardrail:** improve settings navigation ([8cf4e35](https://github.com/salesforce/sf-pi/commit/8cf4e35f0e56d2fdc109a82a9ac2e9286de439f2))

## [0.184.5](https://github.com/salesforce/sf-pi/compare/v0.184.4...v0.184.5) (2026-06-13)


### Bug Fixes

* **sf-guardrail:** use confirmable rule behavior ([8a11b03](https://github.com/salesforce/sf-pi/commit/8a11b0348239017b0d72ee23f6c5d486a57b3ae5))

## [0.184.4](https://github.com/salesforce/sf-pi/compare/v0.184.3...v0.184.4) (2026-06-13)


### Bug Fixes

* **sf-guardrail:** release simplified safety architecture ([5821c21](https://github.com/salesforce/sf-pi/commit/5821c215decc820f48c63e63615963bc22aad346))

## [0.184.3](https://github.com/salesforce/sf-pi/compare/v0.184.2...v0.184.3) (2026-06-13)


### Bug Fixes

* **sf-guardrail:** reduce approval fatigue ([cbfd47f](https://github.com/salesforce/sf-pi/commit/cbfd47f01ae5e06e5988de9b6f38f9f1938387bb))

## [0.184.2](https://github.com/salesforce/sf-pi/compare/v0.184.1...v0.184.2) (2026-06-12)


### Bug Fixes

* **sf-browser:** handle classic setup submits ([0d75612](https://github.com/salesforce/sf-pi/commit/0d75612b607cad2f4925a52b5f24a2aebc3b6086))
* **sf-browser:** remove iframe retry lint warning ([a522649](https://github.com/salesforce/sf-pi/commit/a5226493389de6dfa762efe4bbce643159e20eac))

## [0.184.1](https://github.com/salesforce/sf-pi/compare/v0.184.0...v0.184.1) (2026-06-12)


### Bug Fixes

* **sf-browser:** improve reliability evidence ([ce644fa](https://github.com/salesforce/sf-pi/commit/ce644fa78eb16a73aaa0c4a2028a9ab11033ad3d))

## [0.184.0](https://github.com/salesforce/sf-pi/compare/v0.183.0...v0.184.0) (2026-06-10)


### Features

* **agentscript:** add timings and connection caches ([1186c86](https://github.com/salesforce/sf-pi/commit/1186c86a9795c0c0977d62177f7dd05653ce9e38))

## [0.183.0](https://github.com/salesforce/sf-pi/compare/v0.182.0...v0.183.0) (2026-06-10)


### Features

* **sf-agentscript:** diagnose channel runtime smoke ([9cb6d7e](https://github.com/salesforce/sf-pi/commit/9cb6d7e6d77a647e98a9772d5b26d533ccc53aca))


### Bug Fixes

* remove unused skill source argument ([49660af](https://github.com/salesforce/sf-pi/commit/49660af4f2d91cf92080a942efa78ec27875b0f1))
* respect project trust for skill sources ([da723f5](https://github.com/salesforce/sf-pi/commit/da723f54263f38926543faa292f99cb21d9b2d50))

## [0.182.0](https://github.com/salesforce/sf-pi/compare/v0.181.0...v0.182.0) (2026-06-09)


### Features

* make extension settings surfaces mode-aware ([c72cdbe](https://github.com/salesforce/sf-pi/commit/c72cdbe72d9e312a86a6522fce42d5ddc61c0d4f))
* **sf-agentscript:** preflight published voice planners ([c33d6d3](https://github.com/salesforce/sf-pi/commit/c33d6d3bb62e7b6256f9069c5c1df81bb95680b2))
* **sf-agentscript:** preflight routing flows and queues ([bba1d03](https://github.com/salesforce/sf-pi/commit/bba1d03b2a3a4833cbf676d0504788a48fc29d30))

## [0.181.0](https://github.com/salesforce/sf-pi/compare/v0.180.0...v0.181.0) (2026-06-09)


### Features

* align sf-pi with pi 0.79 runtime ([3fc0a1c](https://github.com/salesforce/sf-pi/commit/3fc0a1c0a1cb1878fbb5c8530cbb9107838d8bd1))

## [0.180.0](https://github.com/salesforce/sf-pi/compare/v0.179.0...v0.180.0) (2026-06-08)


### Features

* **sf-browser:** extend navigation hardening harness to all surfaces ([7537765](https://github.com/salesforce/sf-pi/commit/7537765e15d024c82a83bb7a6a964717d1a6ed0b))


### Bug Fixes

* **docs:** keep README pi floor at &gt;=0.76.0 to match package.json ([bdd2884](https://github.com/salesforce/sf-pi/commit/bdd2884496a9fc2f88b1cf4809447619eea77ffa))

## [0.179.0](https://github.com/salesforce/sf-pi/compare/v0.178.1...v0.179.0) (2026-06-08)


### Features

* **sf-browser:** Data Cloud Destination Pack + navigation hardening harness ([0c053a2](https://github.com/salesforce/sf-pi/commit/0c053a2f9277445dac7fd3d858222adce267e0f9))

## [0.178.1](https://github.com/salesforce/sf-pi/compare/v0.178.0...v0.178.1) (2026-06-08)


### Bug Fixes

* **sf-llm-gateway:** apply priority service tier on gpt-5 Responses path ([ffbf56e](https://github.com/salesforce/sf-pi/commit/ffbf56e0cc4a31b9039976d1b8872a63aa6610b4))

## [0.178.0](https://github.com/salesforce/sf-pi/compare/v0.177.0...v0.178.0) (2026-06-07)


### Features

* **sf-agentscript:** expand channel preflight review ([951d117](https://github.com/salesforce/sf-pi/commit/951d117d3fad4106f6fbe36159dcaea35e5652f4))

## [0.177.0](https://github.com/salesforce/sf-pi/compare/v0.176.0...v0.177.0) (2026-06-07)


### Features

* **sf-agentscript:** preflight voice surface readiness ([054c982](https://github.com/salesforce/sf-pi/commit/054c982bc4c1e509ef18857855920c968939befd))

## [0.176.0](https://github.com/salesforce/sf-pi/compare/v0.175.2...v0.176.0) (2026-06-07)


### Features

* **sf-agentscript:** render structured preview trace reports ([cec667b](https://github.com/salesforce/sf-pi/commit/cec667b3b7e760775771302384a21b2b6ccf02da))

## [0.175.2](https://github.com/salesforce/sf-pi/compare/v0.175.1...v0.175.2) (2026-06-07)


### Bug Fixes

* **sf-agentscript:** suppress agentforce schema debug output ([bf299f9](https://github.com/salesforce/sf-pi/commit/bf299f9e483b0072bc5e62ea04c5eba32f1afe15))

## [0.175.1](https://github.com/salesforce/sf-pi/compare/v0.175.0...v0.175.1) (2026-06-07)


### Bug Fixes

* **sf-agentscript:** compact preview trace output ([00a609b](https://github.com/salesforce/sf-pi/commit/00a609b33cf5e7e5f690c898e891285162452502))

## [0.175.0](https://github.com/salesforce/sf-pi/compare/v0.174.0...v0.175.0) (2026-06-04)


### Features

* **sf-agentscript:** add package freshness doctor ([1757108](https://github.com/salesforce/sf-pi/commit/1757108fb9bc96a34122021e431cf075f6879c10))

## [0.174.0](https://github.com/salesforce/sf-pi/compare/v0.173.0...v0.174.0) (2026-06-04)


### Features

* **sf-agentscript:** report AgentScript package versions ([e62e84e](https://github.com/salesforce/sf-pi/commit/e62e84edfe6d3c4c8f87562d315b61f37f1d84c7))

## [0.173.0](https://github.com/salesforce/sf-pi/compare/v0.172.0...v0.173.0) (2026-06-04)


### Features

* **sf-agentscript:** use official AgentScript packages ([9212335](https://github.com/salesforce/sf-pi/commit/921233503a6125dd4fb5a335998daa1aab38043e))

## [0.172.0](https://github.com/salesforce/sf-pi/compare/v0.171.1...v0.172.0) (2026-06-04)


### Features

* **sf-data360:** add live-read action sweep ([a95094a](https://github.com/salesforce/sf-pi/commit/a95094a607277a3af710abb3160c008f3077b2d7))

## [0.171.1](https://github.com/salesforce/sf-pi/compare/v0.171.0...v0.171.1) (2026-06-04)


### Bug Fixes

* **sf-browser:** diagnose browser launch failures ([c7ea42c](https://github.com/salesforce/sf-pi/commit/c7ea42c0a3234aa021a46f5d7d025142e93be018))

## [0.171.0](https://github.com/salesforce/sf-pi/compare/v0.170.1...v0.171.0) (2026-06-04)


### Features

* **sf-data360:** add v2 action sweep ([2955f3c](https://github.com/salesforce/sf-pi/commit/2955f3c044c97e7850f2e1a9366de747f165931a))

## [0.170.1](https://github.com/salesforce/sf-pi/compare/v0.170.0...v0.170.1) (2026-06-02)


### Bug Fixes

* **sf-data360:** make cleanup discovery actionable ([bf82a8a](https://github.com/salesforce/sf-pi/commit/bf82a8a3fe364a6586006802a8048e548c302c94))

## [0.170.0](https://github.com/salesforce/sf-pi/compare/v0.169.0...v0.170.0) (2026-06-02)


### Features

* **sf-data360:** discover cleanup candidates ([485c3ac](https://github.com/salesforce/sf-pi/commit/485c3acf7da4966b6ace4a8fc5e31881b5421b21))

## [0.169.0](https://github.com/salesforce/sf-pi/compare/v0.168.0...v0.169.0) (2026-06-02)


### Features

* **sf-data360:** add remaining run journeys ([c20ee06](https://github.com/salesforce/sf-pi/commit/c20ee06602557de74d8f3ea3e8f31edce328d6e3))

## [0.168.0](https://github.com/salesforce/sf-pi/compare/v0.167.1...v0.168.0) (2026-06-02)


### Features

* **sf-data360:** polish journey result UX ([a42cab9](https://github.com/salesforce/sf-pi/commit/a42cab9c9fa426ce4a15494f9c42b04e1d0d3711))
* **sf-data360:** run make data usable journey ([00259c5](https://github.com/salesforce/sf-pi/commit/00259c55a7a81f82a55100891b8a31c300ccd2f1))

## [0.167.1](https://github.com/salesforce/sf-pi/compare/v0.167.0...v0.167.1) (2026-06-01)


### Bug Fixes

* **sf-data360:** improve activation plan recommendations ([6326528](https://github.com/salesforce/sf-pi/commit/63265287590ba91d41974ece522ac56f93e6da39))

## [0.167.0](https://github.com/salesforce/sf-pi/compare/v0.166.0...v0.167.0) (2026-06-01)


### Features

* **sf-data360:** add journey readiness preflights ([c4a1338](https://github.com/salesforce/sf-pi/commit/c4a1338dd1e66ddc9a8d69bf778722b1fe7177f6))

## [0.166.0](https://github.com/salesforce/sf-pi/compare/v0.165.0...v0.166.0) (2026-06-01)


### Features

* **sf-data360:** plan segment and activation journeys ([f5a4b1b](https://github.com/salesforce/sf-pi/commit/f5a4b1b31542a3a44d2af51f444e4de7aa7da367))

## [0.165.0](https://github.com/salesforce/sf-pi/compare/v0.164.0...v0.165.0) (2026-06-01)


### Features

* **sf-data360:** plan semantic retrieval journeys ([14e1961](https://github.com/salesforce/sf-pi/commit/14e19612d9d7444c344aca1030d25446120d62b3))

## [0.164.0](https://github.com/salesforce/sf-pi/compare/v0.163.0...v0.164.0) (2026-06-01)


### Features

* **sf-data360:** run agent behavior investigation ([25e9963](https://github.com/salesforce/sf-pi/commit/25e9963453315b3ada32ffecd6d208de18dfd1c3))

## [0.163.0](https://github.com/salesforce/sf-pi/compare/v0.162.3...v0.163.0) (2026-06-01)


### Features

* **sf-data360:** harden journey planning ([372cfd5](https://github.com/salesforce/sf-pi/commit/372cfd5ebb519c1562e3211fbb09ef2e9d7b4e61))

## [0.162.3](https://github.com/salesforce/sf-pi/compare/v0.162.2...v0.162.3) (2026-06-01)


### Bug Fixes

* **sf-data360:** resolve manifest dlo names ([0027303](https://github.com/salesforce/sf-pi/commit/002730315a6a7b73bb45f0fe5091495e7540a68b))

## [0.162.2](https://github.com/salesforce/sf-pi/compare/v0.162.1...v0.162.2) (2026-06-01)


### Bug Fixes

* **sf-data360:** retry manifest ingest job creation ([3f67426](https://github.com/salesforce/sf-pi/commit/3f67426aba69fca2a349406cfd40fc93c7c2d605))

## [0.162.1](https://github.com/salesforce/sf-pi/compare/v0.162.0...v0.162.1) (2026-06-01)


### Bug Fixes

* **sf-data360:** resolve manifest source connector names ([77dbdd0](https://github.com/salesforce/sf-pi/commit/77dbdd032442eb4280c1ebe3d73e81994e35f8cc))

## [0.162.0](https://github.com/salesforce/sf-pi/compare/v0.161.0...v0.162.0) (2026-06-01)


### Features

* **sf-data360:** add journey intent planner ([cd2b4f0](https://github.com/salesforce/sf-pi/commit/cd2b4f09879b84397b995e508424f4988c51e065))

## [0.161.0](https://github.com/salesforce/sf-pi/compare/v0.160.0...v0.161.0) (2026-06-01)


### Features

* **sf-data360:** add data360 family tool surface ([4d33c0c](https://github.com/salesforce/sf-pi/commit/4d33c0cc3da5198a5bfab38c8cbc4bdc293054ee))

## [0.160.0](https://github.com/salesforce/sf-pi/compare/v0.159.0...v0.160.0) (2026-05-31)


### Features

* **sf-browser:** improve navigation and editor workflows ([6b86d9e](https://github.com/salesforce/sf-pi/commit/6b86d9eaec8d4f127afe6a342b47b4af02a9a561))

## [0.159.0](https://github.com/salesforce/sf-pi/compare/v0.158.0...v0.159.0) (2026-05-30)


### Features

* strengthen analyzer recipe guidance ([a81dc9d](https://github.com/salesforce/sf-pi/commit/a81dc9d3d9d6593f91e366590a937e21cfd28cbf))


### Bug Fixes

* satisfy recipe content sniff lint ([4f9d561](https://github.com/salesforce/sf-pi/commit/4f9d561f651dcb5c50bee1ef928ab137f09c146e))

## [0.158.0](https://github.com/salesforce/sf-pi/compare/v0.157.0...v0.158.0) (2026-05-30)


### Features

* add code analyzer scan recipes ([cd46c8e](https://github.com/salesforce/sf-pi/commit/cd46c8eedbfebd0b423c644163033cd2da76b628))

## [0.157.0](https://github.com/salesforce/sf-pi/compare/v0.156.0...v0.157.0) (2026-05-30)


### Features

* expand code analyzer controls ([e5107ad](https://github.com/salesforce/sf-pi/commit/e5107add088babbcf50e7c0fc93a7849163b7c9d))

## [0.156.0](https://github.com/salesforce/sf-pi/compare/v0.155.0...v0.156.0) (2026-05-30)


### Features

* refine code analyzer controls ([79e26c7](https://github.com/salesforce/sf-pi/commit/79e26c7099f129aaf39a8497b18122ae6a2f57ab))

## [0.155.0](https://github.com/salesforce/sf-pi/compare/v0.154.2...v0.155.0) (2026-05-30)


### Features

* add sf-code-analyzer extension ([6e8c4a7](https://github.com/salesforce/sf-pi/commit/6e8c4a79b0974bb1169d3a65e2709fdb07f36e68))
* suggest ApexGuru setup with browser approval ([79a22e9](https://github.com/salesforce/sf-pi/commit/79a22e960ec3ac3634e188e75882c0dfaaf0c5c3))

## [0.154.2](https://github.com/salesforce/sf-pi/compare/v0.154.1...v0.154.2) (2026-05-30)


### Bug Fixes

* **sf-welcome:** show SF Skills availability separately ([fb7a55d](https://github.com/salesforce/sf-pi/commit/fb7a55d187134aef75bc66f5be87be0cfbe2b494))

## [0.154.1](https://github.com/salesforce/sf-pi/compare/v0.154.0...v0.154.1) (2026-05-30)


### Bug Fixes

* align with pi runtime tool selection ([0d0429f](https://github.com/salesforce/sf-pi/commit/0d0429f2dbc02128eab94f88a2e81c7c97ce1414))

## [0.154.0](https://github.com/salesforce/sf-pi/compare/v0.153.0...v0.154.0) (2026-05-29)


### Features

* **sf-skills:** defaults install is local-first (clone once global, wire current project) ([7b1f38c](https://github.com/salesforce/sf-pi/commit/7b1f38c241a33d3572ae01d833ebc9a7bff7bc86))

## [0.153.0](https://github.com/salesforce/sf-pi/compare/v0.152.3...v0.153.0) (2026-05-29)


### Features

* **sf-skills:** rescope skills global → project (local-first migration) ([a15ac28](https://github.com/salesforce/sf-pi/commit/a15ac283f1592d1cc00cfbbede54b16aa3dbeaed))

## [0.152.3](https://github.com/salesforce/sf-pi/compare/v0.152.2...v0.152.3) (2026-05-29)


### Bug Fixes

* **sf-skills:** label managed afv install, stop vanish-on-disable, add scope consolidate ([0aaa7e1](https://github.com/salesforce/sf-pi/commit/0aaa7e165739984f56854d317f39214ca4cab62d))

## [0.152.2](https://github.com/salesforce/sf-pi/compare/v0.152.1...v0.152.2) (2026-05-29)


### Bug Fixes

* cancel deferred timers on session_shutdown so reload can't crash pi ([1bd79d4](https://github.com/salesforce/sf-pi/commit/1bd79d4a6a348c541fc73ff6911af0181827fb7b))

## [0.152.1](https://github.com/salesforce/sf-pi/compare/v0.152.0...v0.152.1) (2026-05-29)


### Bug Fixes

* **sf-skills:** stop input freeze after applying funnel changes ([6f7c4cd](https://github.com/salesforce/sf-pi/commit/6f7c4cd3a0d364b03212d0f5b794d3d9d5bfdf96))

## [0.152.0](https://github.com/salesforce/sf-pi/compare/v0.151.0...v0.152.0) (2026-05-29)


### Features

* **sf-skills:** rewrite as a Skill Funnel governance manager ([36988b7](https://github.com/salesforce/sf-pi/commit/36988b7eb889e714cd0096d6d99fbf72750d3a08))


### Bug Fixes

* **sf-skills:** remove non-null assertions to satisfy eslint --max-warnings=0 ([77cd243](https://github.com/salesforce/sf-pi/commit/77cd243c2cd5f7e4e62b9a9c9ff9e5ea5bc9600b))

## [0.151.0](https://github.com/salesforce/sf-pi/compare/v0.150.0...v0.151.0) (2026-05-28)


### Features

* **sf-llm-gateway-internal:** promote Opus 4.8 to default model ([a8f5055](https://github.com/salesforce/sf-pi/commit/a8f505505830225ddcfa6a3c67794264471a8f67))

## [0.150.0](https://github.com/salesforce/sf-pi/compare/v0.149.7...v0.150.0) (2026-05-28)


### Features

* **sf-llm-gateway-internal:** add Opus 4.8 preset, unlock effort=max for 4.7+ ([d5f770b](https://github.com/salesforce/sf-pi/commit/d5f770b1284f76604f645d5af14899ddf01b7a22))

## [0.149.7](https://github.com/salesforce/sf-pi/compare/v0.149.6...v0.149.7) (2026-05-28)


### Bug Fixes

* align gateway retries with pi provider settings ([94c7c1f](https://github.com/salesforce/sf-pi/commit/94c7c1fc0846be965048e164140b620113781dca))

## [0.149.6](https://github.com/salesforce/sf-pi/compare/v0.149.5...v0.149.6) (2026-05-28)


### Bug Fixes

* **sf-ohana-spinner:** avoid stale ctx in rotation timer ([e80f48b](https://github.com/salesforce/sf-pi/commit/e80f48bb95e4d4e7526998b966ee1fd6f1a699cf))

## [0.149.5](https://github.com/salesforce/sf-pi/compare/v0.149.4...v0.149.5) (2026-05-27)


### Bug Fixes

* extend welcome animation duration ([bc5a931](https://github.com/salesforce/sf-pi/commit/bc5a931302f9b862aa0956de3fe8e9b4a06c717c))

## [0.149.4](https://github.com/salesforce/sf-pi/compare/v0.149.3...v0.149.4) (2026-05-26)


### Bug Fixes

* make welcome startup non-blocking ([2539e38](https://github.com/salesforce/sf-pi/commit/2539e38c78c10eed705fe88a98059082251b7e1a))

## [0.149.3](https://github.com/salesforce/sf-pi/compare/v0.149.2...v0.149.3) (2026-05-26)


### Performance

* cache gateway startup status ([6b1f3fe](https://github.com/salesforce/sf-pi/commit/6b1f3fe59b23f060b285b9a6741f81f9854bf700))

## [0.149.2](https://github.com/salesforce/sf-pi/compare/v0.149.1...v0.149.2) (2026-05-25)


### Performance

* optimize sf-pi startup probes ([a649c68](https://github.com/salesforce/sf-pi/commit/a649c68c4756ee8713b81ebe9c6b863dc40bbbb8))

## [0.149.1](https://github.com/salesforce/sf-pi/compare/v0.149.0...v0.149.1) (2026-05-25)


### Bug Fixes

* clear agent script lint warning ([1900025](https://github.com/salesforce/sf-pi/commit/1900025ee54376fd40e94b4af32d322cc9bbbc8a))

## [0.149.0](https://github.com/salesforce/sf-pi/compare/v0.148.0...v0.149.0) (2026-05-25)


### Features

* add dynamic sf herdr lane planning ([069091c](https://github.com/salesforce/sf-pi/commit/069091ce9eea20b42422f49ede656803686851a2))
* **sf-agentscript:** generate target stubs ([1ee6be8](https://github.com/salesforce/sf-pi/commit/1ee6be8f2450b4570ae8a308a72edb116325145f))
* **sf-agentscript:** report sweep findings ([e6db818](https://github.com/salesforce/sf-pi/commit/e6db81886f091471c9c2d505625986a2df7d2682))


### Bug Fixes

* **sf-agentscript:** detect apex method targets ([c5ddbbd](https://github.com/salesforce/sf-pi/commit/c5ddbbdfb6a29e26c0c76584b902c2e34baa4500))
* **sf-agentscript:** relax generated prerequisite rubrics ([828a2d3](https://github.com/salesforce/sf-pi/commit/828a2d364169504cdcc1537ca44fb633b480794c))
* **sf-agentscript:** soften generated routing rubrics ([347ee6c](https://github.com/salesforce/sf-pi/commit/347ee6cd3356fd6a615556d2f5f8fe9218d1fee9))

## [0.148.0](https://github.com/salesforce/sf-pi/compare/v0.147.0...v0.148.0) (2026-05-24)


### Features

* **sf-brain:** add conditional Herdr workflow guidance ([0ac5ab7](https://github.com/salesforce/sf-pi/commit/0ac5ab7514f8f6c241aa611a54f823d857d58d63))


### Bug Fixes

* **sf-agentscript:** query flow metadata per target ([9374797](https://github.com/salesforce/sf-pi/commit/9374797d2b19f44df126f1c3a008bbee2a18bb1b))

## [0.147.0](https://github.com/salesforce/sf-pi/compare/v0.146.4...v0.147.0) (2026-05-24)


### Features

* **sf-agentscript:** add example sweep script ([ca236fc](https://github.com/salesforce/sf-pi/commit/ca236fcc7c627687432f10adf34bf9ca204a2ea1))


### Bug Fixes

* **sf-agentscript:** block unverifiable standard invocables ([2dd48a9](https://github.com/salesforce/sf-pi/commit/2dd48a941b7eb28aab6dba900a7c6ebde924577f))

## [0.146.4](https://github.com/salesforce/sf-pi/compare/v0.146.3...v0.146.4) (2026-05-24)


### Bug Fixes

* **sf-agentscript:** inspect start agent actions ([3257fea](https://github.com/salesforce/sf-pi/commit/3257fea1ea0a3b267a7e311d5de185ab3b2962ae))
* **sf-agentscript:** narrow target id heuristic ([965761f](https://github.com/salesforce/sf-pi/commit/965761fd2d56f16bdc544642a053eefb5c521c7d))
* **sf-agentscript:** validate flow action contracts ([57bbb21](https://github.com/salesforce/sf-pi/commit/57bbb217f5a868d45ec01da92ee38b7fcada6e11))

## [0.146.3](https://github.com/salesforce/sf-pi/compare/v0.146.2...v0.146.3) (2026-05-24)


### Bug Fixes

* **sf-agentscript:** use turn output in generated eval ratings ([b616c83](https://github.com/salesforce/sf-pi/commit/b616c83e2be76bdea39e56de740f1d79d6bfbe97))

## [0.146.2](https://github.com/salesforce/sf-pi/compare/v0.146.1...v0.146.2) (2026-05-24)


### Bug Fixes

* **sf-agentscript:** generate topic eval probes ([dc1aeaf](https://github.com/salesforce/sf-pi/commit/dc1aeaf59629ca9893c7b15038ea9a37971f7851))
* **sf-agentscript:** review system prompt shape ([e859235](https://github.com/salesforce/sf-pi/commit/e859235e02b49b0e244938ee1c94807bf48b5c59))
* **sf-agentscript:** soften generated eval probes ([67ac270](https://github.com/salesforce/sf-pi/commit/67ac2703e10f1d044c510adc59c40c1ab7c74509))
* **sf-agentscript:** use turn responses in generated evals ([53ab182](https://github.com/salesforce/sf-pi/commit/53ab18200db1f6d95f0d9738991a6da8872881cc))

## [0.146.1](https://github.com/salesforce/sf-pi/compare/v0.146.0...v0.146.1) (2026-05-23)


### Bug Fixes

* **sf-agentscript:** clarify system prompt leak probe ([b7b6504](https://github.com/salesforce/sf-pi/commit/b7b65042dde72803666d50a380dfd57caa76a06c))
* **sf-agentscript:** harden action target diagnostics ([41153c0](https://github.com/salesforce/sf-pi/commit/41153c05b9334446e3c12b09d49ab2ea5e27a653))

## [0.146.0](https://github.com/salesforce/sf-pi/compare/v0.145.0...v0.146.0) (2026-05-23)


### Features

* **sf-agentscript:** refactor tool surface ([446b7a8](https://github.com/salesforce/sf-pi/commit/446b7a81b6b48d2a12991140878072ac907947de))

## [0.145.0](https://github.com/salesforce/sf-pi/compare/v0.144.5...v0.145.0) (2026-05-23)


### Features

* **brain:** prioritize bundled extension workflows ([f181d96](https://github.com/salesforce/sf-pi/commit/f181d96d4fb5bcef012753982c1a8ddc72ca7ecc))


### Bug Fixes

* **gateway:** use pi adaptive thinking ([69556fb](https://github.com/salesforce/sf-pi/commit/69556fb3f793df4ad1b34547a6c7d7884474ff5f))

## [0.144.5](https://github.com/salesforce/sf-pi/compare/v0.144.4...v0.144.5) (2026-05-23)


### Bug Fixes

* harden filesystem paths and isolate tests ([6c9ed45](https://github.com/salesforce/sf-pi/commit/6c9ed45cb526f7c0b59e7b25a5558047c80aabd0))

## [0.144.4](https://github.com/salesforce/sf-pi/compare/v0.144.3...v0.144.4) (2026-05-23)


### Bug Fixes

* respect npm release cooldown for pi freshness ([d232036](https://github.com/salesforce/sf-pi/commit/d232036b635fd7d9f8618222df97438575c19361))

## [0.144.3](https://github.com/salesforce/sf-pi/compare/v0.144.2...v0.144.3) (2026-05-23)


### Bug Fixes

* **sf-agentscript:** harden channel preview lifecycle ([581fe15](https://github.com/salesforce/sf-pi/commit/581fe15e4c3ab79387476f534d74c5de0726f176))

## [0.144.2](https://github.com/salesforce/sf-pi/compare/v0.144.1...v0.144.2) (2026-05-22)


### Bug Fixes

* **sf-agentscript:** harden preview surface diagnostics ([5b61b37](https://github.com/salesforce/sf-pi/commit/5b61b377568103decc87b9851aa7c13517abde11))

## [0.144.1](https://github.com/salesforce/sf-pi/compare/v0.144.0...v0.144.1) (2026-05-22)


### Bug Fixes

* **sf-agentscript:** support linked context preview variables ([7418973](https://github.com/salesforce/sf-pi/commit/7418973f91af8b40501b377ffd9914ee79219323))

## [0.144.0](https://github.com/salesforce/sf-pi/compare/v0.143.0...v0.144.0) (2026-05-22)


### Features

* **agentscript:** improve eval and preview lifecycle ([c7b6ba1](https://github.com/salesforce/sf-pi/commit/c7b6ba1c44d13978c5335d20eaaac5c22af31149))

## [0.143.0](https://github.com/salesforce/sf-pi/compare/v0.142.1...v0.143.0) (2026-05-21)


### Features

* **sf-data-explorer:** add read-only SOQL/SOSL/Data 360 SQL TUI ([#261](https://github.com/salesforce/sf-pi/issues/261)) ([26d22f9](https://github.com/salesforce/sf-pi/commit/26d22f9cb64c048a102cbfdf1ebd1d304fc753f4))

## [0.142.1](https://github.com/salesforce/sf-pi/compare/v0.142.0...v0.142.1) (2026-05-21)


### Bug Fixes

* handle feedback permissions and skills HUD ([aa55e16](https://github.com/salesforce/sf-pi/commit/aa55e16653aa492598d82dd71c47b6894a0eaff3))

## [0.142.0](https://github.com/salesforce/sf-pi/compare/v0.141.1...v0.142.0) (2026-05-21)


### Features

* **sf-welcome:** show release freshness ([1ef7f07](https://github.com/salesforce/sf-pi/commit/1ef7f0750c3eff6dea48caf4f7e58f384404acb6))

## [0.141.1](https://github.com/salesforce/sf-pi/compare/v0.141.0...v0.141.1) (2026-05-21)


### Bug Fixes

* require pi 0.75.4 runtime ([99da2ed](https://github.com/salesforce/sf-pi/commit/99da2edb792deb8708ec6bdd959781ffe8af67e0))

## [0.141.0](https://github.com/salesforce/sf-pi/compare/v0.140.0...v0.141.0) (2026-05-21)


### Features

* **sf-browser:** add session evidence and lightning navigation reliability ([988abc9](https://github.com/salesforce/sf-pi/commit/988abc9d78e3c481cab0b18998d4f91ca0032c6b))
* **sf-browser:** add session evidence report command ([eeb0a89](https://github.com/salesforce/sf-pi/commit/eeb0a89c3340fa2376c8fec0489b375956e7fa86))


### Bug Fixes

* **sf-browser:** add failure diagnostics for browser actions ([5bf7c11](https://github.com/salesforce/sf-pi/commit/5bf7c113e6bd6c257d1715421c8b735c53ef08a8))
* **sf-browser:** classify classic setup save results ([fe2bb40](https://github.com/salesforce/sf-pi/commit/fe2bb40cb8db7cf1526b51486aff9a4f2ff35080))
* **sf-browser:** harden lightning waits and add live smoke checklist ([41eae99](https://github.com/salesforce/sf-pi/commit/41eae99cb66d5976953b554f5ab6b5b3aa96f9aa))
* **sf-browser:** reduce noisy setup snapshot summaries ([0f46079](https://github.com/salesforce/sf-pi/commit/0f4607939ba3101484dda030e88223666eeee663))
* **sf-browser:** satisfy lint for lightning state parser ([25909b0](https://github.com/salesforce/sf-pi/commit/25909b0c6cf98f640144dcaa026f942553fd00b5))
* **sf-browser:** use fuller viewport for thumbnail evidence ([a9dd99a](https://github.com/salesforce/sf-pi/commit/a9dd99aabde9b93c9fa517e30ae2aa8ddcd4f95f))

## [0.140.0](https://github.com/salesforce/sf-pi/compare/v0.139.0...v0.140.0) (2026-05-20)


### Features

* expand sf-browser runbooks ([8438ab6](https://github.com/salesforce/sf-pi/commit/8438ab65f8333ef38a08292f3113ae42b977ef24))

## [0.139.0](https://github.com/salesforce/sf-pi/compare/v0.138.0...v0.139.0) (2026-05-20)


### Features

* improve sf-browser snapshot summaries ([61a582d](https://github.com/salesforce/sf-pi/commit/61a582dfd09bf98872022a2de1de877a1f2706c7))

## [0.138.0](https://github.com/salesforce/sf-pi/compare/v0.137.0...v0.138.0) (2026-05-20)


### Features

* expand sf-browser setup destinations ([6d9c9f0](https://github.com/salesforce/sf-pi/commit/6d9c9f075474ad86c4e040be21164d8d43ade963))

## [0.137.0](https://github.com/salesforce/sf-pi/compare/v0.136.0...v0.137.0) (2026-05-20)


### Features

* harden sf-browser setup runbooks ([6675b64](https://github.com/salesforce/sf-pi/commit/6675b644e98fee6fd108e64aca942d031db276a2))

## [0.136.0](https://github.com/salesforce/sf-pi/compare/v0.135.0...v0.136.0) (2026-05-20)


### Features

* add sf-browser extension ([584a438](https://github.com/salesforce/sf-pi/commit/584a4383c5a9812fa489060840587dc09bba8b6e))


### Bug Fixes

* use literal sf-browser pi version gate ([d446505](https://github.com/salesforce/sf-pi/commit/d4465054fa957ca120146d5233736bc8e3eaac00))

## [0.135.0](https://github.com/salesforce/sf-pi/compare/v0.134.0...v0.135.0) (2026-05-19)


### Features

* add d360 retriever mutation lifecycle ([4548a67](https://github.com/salesforce/sf-pi/commit/4548a67078375447d9e74d71a61521b759cb4fbb))

## [0.134.0](https://github.com/salesforce/sf-pi/compare/v0.133.0...v0.134.0) (2026-05-19)


### Features

* add d360 search and retriever readiness lifecycles ([ed94d7e](https://github.com/salesforce/sf-pi/commit/ed94d7e61b65eb19f7b5a5c7da6cf645bac344ac))

## [0.133.0](https://github.com/salesforce/sf-pi/compare/v0.132.0...v0.133.0) (2026-05-19)


### Features

* add d360 activation lifecycle ([43478f3](https://github.com/salesforce/sf-pi/commit/43478f318570e60b079cefaf26f5679c42d7082a))

## [0.132.0](https://github.com/salesforce/sf-pi/compare/v0.131.0...v0.132.0) (2026-05-19)


### Features

* add d360 segment and activation target lifecycles ([1948b59](https://github.com/salesforce/sf-pi/commit/1948b59ce2ef45571f98f79fdcd4b5d4304de230))

## [0.131.0](https://github.com/salesforce/sf-pi/compare/v0.130.0...v0.131.0) (2026-05-19)


### Features

* add d360 calculated insight lifecycle ([0d5ad57](https://github.com/salesforce/sf-pi/commit/0d5ad5785a7297e5029c2249cf1fd025335624ba))

## [0.130.0](https://github.com/salesforce/sf-pi/compare/v0.129.0...v0.130.0) (2026-05-19)


### Features

* add d360 sweep lifecycle controls ([4f153a4](https://github.com/salesforce/sf-pi/commit/4f153a4e35012b57b2f43562c44a81a68bd4cc3f))

## [0.129.0](https://github.com/salesforce/sf-pi/compare/v0.128.0...v0.129.0) (2026-05-19)


### Features

* add d360 sweep controls and data action lifecycle ([f17d1c9](https://github.com/salesforce/sf-pi/commit/f17d1c99b65519afd7ba3361159770ece2a177a7))

## [0.128.0](https://github.com/salesforce/sf-pi/compare/v0.127.0...v0.128.0) (2026-05-19)


### Features

* make d360 relationship lifecycle green ([252bb3e](https://github.com/salesforce/sf-pi/commit/252bb3e3d9c128f7c2a5b86d4d5a58ad23348339))

## [0.127.0](https://github.com/salesforce/sf-pi/compare/v0.126.0...v0.127.0) (2026-05-19)


### Features

* add d360 transform update and schedule sweep ([dba3c1a](https://github.com/salesforce/sf-pi/commit/dba3c1abe99a29d5d90c183a98382bd782d6edc2))

## [0.126.0](https://github.com/salesforce/sf-pi/compare/v0.125.0...v0.126.0) (2026-05-19)


### Features

* add d360 transform and relationship sweep coverage ([0c2646b](https://github.com/salesforce/sf-pi/commit/0c2646b2cf260406d1c01a47bde91c5e72b2e4a3))

## [0.125.0](https://github.com/salesforce/sf-pi/compare/v0.124.0...v0.125.0) (2026-05-19)


### Features

* **sf-welcome:** polish wordmark shadow ([e737d5f](https://github.com/salesforce/sf-pi/commit/e737d5faf3cbfebd5ceff684942e33efe0eafac1))

## [0.124.0](https://github.com/salesforce/sf-pi/compare/v0.123.0...v0.124.0) (2026-05-19)


### Features

* add d360 semantic metric lifecycle ([6935713](https://github.com/salesforce/sf-pi/commit/6935713b57f2dc9af534e9b65d395495203a01fc))

## [0.123.0](https://github.com/salesforce/sf-pi/compare/v0.122.0...v0.123.0) (2026-05-19)


### Features

* add d360 semantic calculated fields lifecycle ([7051ded](https://github.com/salesforce/sf-pi/commit/7051ded45732242f2a3dfd46651d404fe08925db))

## [0.122.0](https://github.com/salesforce/sf-pi/compare/v0.121.0...v0.122.0) (2026-05-19)


### Features

* add d360 semantic data object lifecycle ([8894b93](https://github.com/salesforce/sf-pi/commit/8894b93520eab47030f3dd86c9d7c70faee87bf8))

## [0.121.0](https://github.com/salesforce/sf-pi/compare/v0.120.0...v0.121.0) (2026-05-19)


### Features

* add d360 semantic model lifecycle ([07eacff](https://github.com/salesforce/sf-pi/commit/07eacff9df374cab45ecf0bc49e1054c170b8dd8))

## [0.120.0](https://github.com/salesforce/sf-pi/compare/v0.119.0...v0.120.0) (2026-05-19)


### Features

* add d360 mapping mutation lifecycle ([c348350](https://github.com/salesforce/sf-pi/commit/c348350edf45581b5a988b75edca20cc0371e80c))

## [0.119.0](https://github.com/salesforce/sf-pi/compare/v0.118.0...v0.119.0) (2026-05-19)


### Features

* add d360 dlo mutation lifecycle ([2b99cac](https://github.com/salesforce/sf-pi/commit/2b99cac20a670ff6fe112b8cff1a1d250d9196aa))

## [0.118.0](https://github.com/salesforce/sf-pi/compare/v0.117.0...v0.118.0) (2026-05-19)


### Features

* add d360 dmo mutation lifecycle ([6d199b7](https://github.com/salesforce/sf-pi/commit/6d199b744e54a9f0dde094d0a6c9cd4f0331c380))

## [0.117.0](https://github.com/salesforce/sf-pi/compare/v0.116.0...v0.117.0) (2026-05-19)


### Features

* expand d360 sweep live coverage ([727553a](https://github.com/salesforce/sf-pi/commit/727553a7b7218ac59f4207fd8709a747f4311060))

## [0.116.0](https://github.com/salesforce/sf-pi/compare/v0.115.0...v0.116.0) (2026-05-19)


### Features

* add dynamic d360 sweep detail coverage ([768f174](https://github.com/salesforce/sf-pi/commit/768f174a87f49c91f32dcb2e318ed4dc97828558))

## [0.115.0](https://github.com/salesforce/sf-pi/compare/v0.114.0...v0.115.0) (2026-05-19)


### Features

* add d360 capability sweep e2e ([8593fa6](https://github.com/salesforce/sf-pi/commit/8593fa6fba323aba80bc7bbbebdbc4717fc5ec91))

## [0.114.0](https://github.com/salesforce/sf-pi/compare/v0.113.0...v0.114.0) (2026-05-19)


### Features

* **sf-data360:** add payload example variants ([d61ac39](https://github.com/salesforce/sf-pi/commit/d61ac399acbe1ab910ba63f7d578c57d5c755a55))

## [0.113.0](https://github.com/salesforce/sf-pi/compare/v0.112.0...v0.113.0) (2026-05-19)


### Features

* **sf-data360:** generate phase skill pack ([2e5bced](https://github.com/salesforce/sf-pi/commit/2e5bcedea7aac675669ec52132bce505d2537b5b))

## [0.112.0](https://github.com/salesforce/sf-pi/compare/v0.111.0...v0.112.0) (2026-05-18)


### Features

* **sf-data360:** improve result card readability ([feb2089](https://github.com/salesforce/sf-pi/commit/feb20899802aa807d7a6b4a0dfa24f6e28f66309))

## [0.111.0](https://github.com/salesforce/sf-pi/compare/v0.110.0...v0.111.0) (2026-05-18)


### Features

* **sf-welcome:** add Node CA status ([4326001](https://github.com/salesforce/sf-pi/commit/43260014a53c21b7507abd44ff35f6a4b09d0c34))

## [0.110.0](https://github.com/salesforce/sf-pi/compare/v0.109.0...v0.110.0) (2026-05-18)


### Features

* **gateway:** add latency probe and simplify Opus betas ([8b31b31](https://github.com/salesforce/sf-pi/commit/8b31b313fe7525d11c8a330b9fea407f46115d46))

## [0.109.0](https://github.com/salesforce/sf-pi/compare/v0.108.0...v0.109.0) (2026-05-18)


### Features

* **gateway:** discover existing onboarding assets ([ba1658a](https://github.com/salesforce/sf-pi/commit/ba1658a4a419b514892075c3f664fe050bbbe30b))


### Bug Fixes

* **gateway:** satisfy onboarding source lint ([c893f32](https://github.com/salesforce/sf-pi/commit/c893f32ce39bdeeaf2453d3c736c3deea65db269))
* **welcome:** ignore nested subagent sessions ([7c8f8b8](https://github.com/salesforce/sf-pi/commit/7c8f8b8c2ed0841a089f96c31ffde57b483fa0d4))

## [0.108.0](https://github.com/salesforce/sf-pi/compare/v0.107.1...v0.108.0) (2026-05-18)


### Features

* **data360:** improve helper cards and destructive preflight ([c8726c3](https://github.com/salesforce/sf-pi/commit/c8726c38371a0f4fc81684d7f5a528681d1ed6e8))

## [0.107.1](https://github.com/salesforce/sf-pi/compare/v0.107.0...v0.107.1) (2026-05-18)


### Bug Fixes

* improve pi working-state rescue UX ([824330b](https://github.com/salesforce/sf-pi/commit/824330b59e227eade11720c9e886fdf193454d8c))
* simplify calm spinner text ([bd05dfc](https://github.com/salesforce/sf-pi/commit/bd05dfc34b84d043d50004ea32147051c0cad71e))

## [0.107.0](https://github.com/salesforce/sf-pi/compare/v0.106.0...v0.107.0) (2026-05-18)


### Features

* **data360:** add local helper facade ops ([0c4b47c](https://github.com/salesforce/sf-pi/commit/0c4b47caf1c63c0c442d1727688c1281510c7c72))

## [0.106.0](https://github.com/salesforce/sf-pi/compare/v0.105.0...v0.106.0) (2026-05-18)


### Features

* **data360:** add destructive facade guardrails ([7277064](https://github.com/salesforce/sf-pi/commit/7277064cdf618940f9f47080fd3002d8f26995fb))

## [0.105.0](https://github.com/salesforce/sf-pi/compare/v0.104.0...v0.105.0) (2026-05-18)


### Features

* **data360:** add standard mapping facade ops ([c3ca0aa](https://github.com/salesforce/sf-pi/commit/c3ca0aa6f7edcb235d6ee7dc1ad6df2dcb6a6243))

## [0.104.0](https://github.com/salesforce/sf-pi/compare/v0.103.0...v0.104.0) (2026-05-18)


### Features

* **data360:** add datakit deploy lifecycle ops ([0aeb329](https://github.com/salesforce/sf-pi/commit/0aeb32981b2c2eabb6a465657b1235d9485c497e))

## [0.103.0](https://github.com/salesforce/sf-pi/compare/v0.102.0...v0.103.0) (2026-05-18)


### Features

* **data360:** add semantic model lifecycle ops ([85ecb1b](https://github.com/salesforce/sf-pi/commit/85ecb1bebf9b78379549cb6c9894eab6226cf04e))

## [0.102.0](https://github.com/salesforce/sf-pi/compare/v0.101.1...v0.102.0) (2026-05-18)


### Features

* **data360:** add identity dataspace lifecycle ops ([ccdcbe6](https://github.com/salesforce/sf-pi/commit/ccdcbe6744ca3c08fe26ec497ecef4da586b1315))

## [0.101.1](https://github.com/salesforce/sf-pi/compare/v0.101.0...v0.101.1) (2026-05-18)


### Bug Fixes

* **sf-llm-gateway-internal:** preserve explicit model allow-lists ([d4a3d73](https://github.com/salesforce/sf-pi/commit/d4a3d7348f98c39182a34387e7dec75ce59a6e68)), closes [#163](https://github.com/salesforce/sf-pi/issues/163)

## [0.101.0](https://github.com/salesforce/sf-pi/compare/v0.100.0...v0.101.0) (2026-05-18)


### Features

* **data360:** add connection lifecycle ops ([76011c7](https://github.com/salesforce/sf-pi/commit/76011c735b7962440e5d35e69bd9a8f13bdc6908))

## [0.100.0](https://github.com/salesforce/sf-pi/compare/v0.99.0...v0.100.0) (2026-05-18)


### Features

* **data360:** add model mapping lifecycle ops ([71347ee](https://github.com/salesforce/sf-pi/commit/71347ee5bc99d812ff70013ee0087cb78889130a))

## [0.99.0](https://github.com/salesforce/sf-pi/compare/v0.98.0...v0.99.0) (2026-05-18)


### Features

* **data360:** add data stream lifecycle ops ([a7ff87f](https://github.com/salesforce/sf-pi/commit/a7ff87f0a3833bbaf0849002df5c5a96bd048cbf))

## [0.98.0](https://github.com/salesforce/sf-pi/compare/v0.97.0...v0.98.0) (2026-05-18)


### Features

* **data360:** add retriever search lifecycle ops ([5ceb4b9](https://github.com/salesforce/sf-pi/commit/5ceb4b94b749c0461af79069069cccbc307d5331))

## [0.97.0](https://github.com/salesforce/sf-pi/compare/v0.96.0...v0.97.0) (2026-05-18)


### Features

* **data360:** add data action lifecycle ops ([c146196](https://github.com/salesforce/sf-pi/commit/c146196985cc2eaabdb3d39c70521840f2ca23cd))

## [0.96.0](https://github.com/salesforce/sf-pi/compare/v0.95.0...v0.96.0) (2026-05-18)


### Features

* **data360:** add transform lifecycle ops ([73c7693](https://github.com/salesforce/sf-pi/commit/73c7693cdc2c3e885006404b45e1d6afca9ef7d4))

## [0.95.0](https://github.com/salesforce/sf-pi/compare/v0.94.1...v0.95.0) (2026-05-18)


### Features

* **data360:** add activation lifecycle ops ([2fe7ec5](https://github.com/salesforce/sf-pi/commit/2fe7ec57d67c00cc250147d52f8cc9c6eefa8793))

## [0.94.1](https://github.com/salesforce/sf-pi/compare/v0.94.0...v0.94.1) (2026-05-18)


### Bug Fixes

* improve sf-pi install preflight ([56e4042](https://github.com/salesforce/sf-pi/commit/56e4042545975e22b4a3f57460e2d7fa057a35fd))

## [0.94.0](https://github.com/salesforce/sf-pi/compare/v0.93.0...v0.94.0) (2026-05-18)


### Features

* **sf-devbar:** inject env context once + on org change, not every turn ([e0ae1b1](https://github.com/salesforce/sf-pi/commit/e0ae1b1251d8b1e1ba649fc53ed629a565cd4e38))


### Bug Fixes

* **data360:** require explicit confirmed execution ([a9b2bd9](https://github.com/salesforce/sf-pi/commit/a9b2bd9ea570cf1b319ae1546e275efc68b90e2e))

## [0.93.0](https://github.com/salesforce/sf-pi/compare/v0.92.0...v0.93.0) (2026-05-18)


### Features

* **data360:** add segment lifecycle ops ([6f2aa8a](https://github.com/salesforce/sf-pi/commit/6f2aa8ad13f13c426ceb93af22e0cc81b9bd94e8))


### Bug Fixes

* **sf-guardrail:** inject prompt as live custom_message, not stale custom marker ([79f61ab](https://github.com/salesforce/sf-pi/commit/79f61ab3901e4765e222832984288febb5ab7ffa))
* **sf-slack:** inject workspace identity once per live session, not every turn ([bef964b](https://github.com/salesforce/sf-pi/commit/bef964b97e3918eb63b9bd6fabd3a8870c44b692))

## [0.92.0](https://github.com/salesforce/sf-pi/compare/v0.91.1...v0.92.0) (2026-05-17)


### Features

* **data360:** add calculated insight lifecycle ops ([058f18e](https://github.com/salesforce/sf-pi/commit/058f18e75a0972f8ca4a3d9abd9c91285aa70c61))

## [0.91.1](https://github.com/salesforce/sf-pi/compare/v0.91.0...v0.91.1) (2026-05-17)


### Bug Fixes

* **data360:** clarify metadata search errors ([68bd04f](https://github.com/salesforce/sf-pi/commit/68bd04fe7517ece96b39467c4453e04e41e342fe))

## [0.91.0](https://github.com/salesforce/sf-pi/compare/v0.90.1...v0.91.0) (2026-05-17)


### Features

* **data360:** add safe post facade operations ([eb18f73](https://github.com/salesforce/sf-pi/commit/eb18f7395c4e9d8f1111c6acc1c449c73ecea11a))

## [0.90.1](https://github.com/salesforce/sf-pi/compare/v0.90.0...v0.90.1) (2026-05-17)


### Bug Fixes

* **data360:** refresh tools on reload ([4ab0810](https://github.com/salesforce/sf-pi/commit/4ab0810278eaafa2b5e86f931e110aacc94111ec))
* **data360:** reload registry json dynamically ([0da8364](https://github.com/salesforce/sf-pi/commit/0da8364843496bd99949a6ffacf7aa7de4181fdd))

## [0.90.0](https://github.com/salesforce/sf-pi/compare/v0.89.0...v0.90.0) (2026-05-17)


### Features

* **data360:** import read-only facade operations ([eb2a13b](https://github.com/salesforce/sf-pi/commit/eb2a13b9806914c80b341221ecbd3c8e4caa086c))

## [0.89.0](https://github.com/salesforce/sf-pi/compare/v0.88.0...v0.89.0) (2026-05-17)


### Features

* **data360:** add registry generator ([55dacf9](https://github.com/salesforce/sf-pi/commit/55dacf9930dc448dd2e1655ecaabdb8272451d98))


### Bug Fixes

* **sf-brain:** inject kernel as live custom_message, re-inject after compaction ([6f25fe3](https://github.com/salesforce/sf-pi/commit/6f25fe373fe8ba48c9625de0200165611a2157aa))

## [0.88.0](https://github.com/salesforce/sf-pi/compare/v0.87.1...v0.88.0) (2026-05-17)


### Features

* **data360:** expand read-only facade registry ([5e5897d](https://github.com/salesforce/sf-pi/commit/5e5897d733ef46e8bcebdc4813e40a1b7e1e663b))

## [0.87.1](https://github.com/salesforce/sf-pi/compare/v0.87.0...v0.87.1) (2026-05-17)


### Bug Fixes

* **data360:** keep card titles before artifacts ([4e6ed13](https://github.com/salesforce/sf-pi/commit/4e6ed13ebcccd3b446942a99c066b7b5134df44e))

## [0.87.0](https://github.com/salesforce/sf-pi/compare/v0.86.0...v0.87.0) (2026-05-17)


### Features

* **data360:** render api result cards ([063b572](https://github.com/salesforce/sf-pi/commit/063b572965948a61c913867c8b59c0151630e371))

## [0.86.0](https://github.com/salesforce/sf-pi/compare/v0.85.0...v0.86.0) (2026-05-17)


### Features

* **data360:** compact metadata output ([19b030f](https://github.com/salesforce/sf-pi/commit/19b030f33552948034241e1573193a38a95c8f12))

## [0.85.0](https://github.com/salesforce/sf-pi/compare/v0.84.0...v0.85.0) (2026-05-17)


### Features

* **data360:** compact probe output ([7a84795](https://github.com/salesforce/sf-pi/commit/7a84795a65716b1ba7342abd1fcd6ae716a2d9f2))

## [0.84.0](https://github.com/salesforce/sf-pi/compare/v0.83.0...v0.84.0) (2026-05-17)


### Features

* **data360:** render facade result cards ([b9af7da](https://github.com/salesforce/sf-pi/commit/b9af7da68b38829fb54d2672d241469889f854f1))

## [0.83.0](https://github.com/salesforce/sf-pi/compare/v0.82.0...v0.83.0) (2026-05-17)


### Features

* **data360:** compact facade output ([271b6bf](https://github.com/salesforce/sf-pi/commit/271b6bfaf9ca99e199b4eb11ab61381f970f5480))

## [0.82.0](https://github.com/salesforce/sf-pi/compare/v0.81.0...v0.82.0) (2026-05-17)


### Features

* **data360:** add standard result card ([4ef3099](https://github.com/salesforce/sf-pi/commit/4ef309965769756a7bf339f071adb85851cc5585))

## [0.81.0](https://github.com/salesforce/sf-pi/compare/v0.80.1...v0.81.0) (2026-05-17)


### Features

* add ohana spinner calm mode ([faebd21](https://github.com/salesforce/sf-pi/commit/faebd2166c8123b32e842c0a97769dec649d9027))

## [0.80.1](https://github.com/salesforce/sf-pi/compare/v0.80.0...v0.80.1) (2026-05-17)


### Bug Fixes

* **data360:** handle missing tracing table in runbooks ([074fccc](https://github.com/salesforce/sf-pi/commit/074fccc20ec0cfafb7f94d1a2434ce486d87af5a))

## [0.80.0](https://github.com/salesforce/sf-pi/compare/v0.79.0...v0.80.0) (2026-05-17)


### Features

* **data360:** add facade runbook tool ([3cedb52](https://github.com/salesforce/sf-pi/commit/3cedb526cf054a1713095878907167d0c7cced16))

## [0.79.0](https://github.com/salesforce/sf-pi/compare/v0.78.1...v0.79.0) (2026-05-17)


### Features

* **sf-llm-gateway:** TLS-aware doctor + one-shot onboard + macOS CA bundle fixer ([78fac0c](https://github.com/salesforce/sf-pi/commit/78fac0c817e382741a7ef7f882d62dc4bd978e0f))

## [0.78.1](https://github.com/salesforce/sf-pi/compare/v0.78.0...v0.78.1) (2026-05-17)


### Bug Fixes

* **data360:** probe platform tracing via DLO ([5c8ae56](https://github.com/salesforce/sf-pi/commit/5c8ae5680136fbd56590e805d1aee5cf466c884c))

## [0.78.0](https://github.com/salesforce/sf-pi/compare/v0.77.1...v0.78.0) (2026-05-17)


### Features

* **data360:** add agent platform tracing workflow ([515f48f](https://github.com/salesforce/sf-pi/commit/515f48f44843906a3bfab73f3c10dd3d6556b21c))

## [0.77.1](https://github.com/salesforce/sf-pi/compare/v0.77.0...v0.77.1) (2026-05-17)


### Bug Fixes

* **sf-llm-gateway-internal:** disable per-tool eager_input_streaming for Haiku 4.5 ([62f0f04](https://github.com/salesforce/sf-pi/commit/62f0f04aef3f79e88c57e9b403907603e9a0db7d)), closes [#166](https://github.com/salesforce/sf-pi/issues/166)

## [0.77.0](https://github.com/salesforce/sf-pi/compare/v0.76.1...v0.77.0) (2026-05-17)


### Features

* **sf-welcome:** add SF Skills row tracking forcedotcom/afv-library ([#178](https://github.com/salesforce/sf-pi/issues/178)) ([7d37593](https://github.com/salesforce/sf-pi/commit/7d37593624c9c5cb7d3026ef2b7ac8328b75a18a))

## [0.76.1](https://github.com/salesforce/sf-pi/compare/v0.76.0...v0.76.1) (2026-05-17)


### Bug Fixes

* **pi-compat:** align MIN_PI_VERSION + peer-floor test with pi 0.74.1 ([#177](https://github.com/salesforce/sf-pi/issues/177)) ([61a9c44](https://github.com/salesforce/sf-pi/commit/61a9c44f21560d18734af70d1d8406a52e1d4f96))
* **sf-pi-manager:** scroll extension list on small terminals ([#175](https://github.com/salesforce/sf-pi/issues/175)) ([38dff75](https://github.com/salesforce/sf-pi/commit/38dff7544819503fb6de34462fc9e518e22d9cba)), closes [#174](https://github.com/salesforce/sf-pi/issues/174)

## [0.76.0](https://github.com/salesforce/sf-pi/compare/v0.75.4...v0.76.0) (2026-05-16)


### Features

* **sf-skills:** forcedotcom/afv-library install + update + link/unlink ([b558d69](https://github.com/salesforce/sf-pi/commit/b558d692291bd71561408f8645626435e9ab6765))
* **sf-skills:** friendly source labels for the datatable ([85eda2b](https://github.com/salesforce/sf-pi/commit/85eda2b8894a5e1f744c4ef8fc2dc9dd8dc30dcf))
* **sf-skills:** persisted usage counters + Stats tab + /sf-skills metrics ([48e7ea4](https://github.com/salesforce/sf-pi/commit/48e7ea447548224beba0aee3100661111b1a21f5))
* **sf-skills:** project-scope skill sources ([5d4925c](https://github.com/salesforce/sf-pi/commit/5d4925c20eae03ef09bbbe9a9a0ab54768835adf))
* **sf-skills:** prune (stale settings + orphan managed clones) ([d2a767d](https://github.com/salesforce/sf-pi/commit/d2a767deb44900b6cb37452d5e5d51c089b52af8))
* **sf-skills:** redesigned datatable overlay with fixed height + scroll + filter ([36cfc0c](https://github.com/salesforce/sf-pi/commit/36cfc0cb8863deff5de5e76e8b6f977da50f7da2))
* **sf-skills:** tabbed datatable overlay (Active / Discover / Stats) ([7193a36](https://github.com/salesforce/sf-pi/commit/7193a36151ba24fe912b0c41b251bf1a7db4a9fa))
* **sf-skills:** viewport scroll math (slice 2 of 3 for the redesign) ([920563e](https://github.com/salesforce/sf-pi/commit/920563eedf223ea3f5aa4e58aee40da4977ae196))


### Bug Fixes

* **sf-skills:** cross-scope coverage check on planEnable ([0fa8251](https://github.com/salesforce/sf-pi/commit/0fa8251b2d96547fe21e0549fe8153425c520d6f))
* **sf-skills:** drop forbidden non-null assertions for CI eslint ([f57f3cc](https://github.com/salesforce/sf-pi/commit/f57f3cc8ae40a325aaf3f8b4648f0050ffc164e8))
* **sf-skills:** native auto-expand / no-op for parent-dir-covered toggles ([8d7e8c2](https://github.com/salesforce/sf-pi/commit/8d7e8c273fbad66c42faa0cdb4fc0a963e3230bf))
* **sf-skills:** scroll indicator anchored to right edge + flexible source column ([571ef92](https://github.com/salesforce/sf-pi/commit/571ef92d063cde075d54d934966336d989be8016))

## [0.75.4](https://github.com/salesforce/sf-pi/compare/v0.75.3...v0.75.4) (2026-05-16)


### Bug Fixes

* repair agentscript SDK sync path ([0ba9ac7](https://github.com/salesforce/sf-pi/commit/0ba9ac76c6d8454cc28383c5fd817b4ab741af5b))

## [0.75.3](https://github.com/salesforce/sf-pi/compare/v0.75.2...v0.75.3) (2026-05-15)


### Bug Fixes

* **sf-agentscript:** preview preflight should accept Active version under newer Inactive ones ([47432c5](https://github.com/salesforce/sf-pi/commit/47432c58538ac5ddd71bda7685899b0587445f49))

## [0.75.2](https://github.com/salesforce/sf-pi/compare/v0.75.1...v0.75.2) (2026-05-15)


### Bug Fixes

* **sf-agentscript:** generate_spec emits the correct bot_response_rating wire shape ([d5f27d5](https://github.com/salesforce/sf-pi/commit/d5f27d5b2196d266fbbadfa8b8f95dd92921f2b8))

## [0.75.1](https://github.com/salesforce/sf-pi/compare/v0.75.0...v0.75.1) (2026-05-15)


### Bug Fixes

* **sf-agentscript:** $active_bot_id alone shouldn't trigger active resolver ([fb80a15](https://github.com/salesforce/sf-pi/commit/fb80a1529160147725af9fbedc7e6ca9d6e9b665))

## [0.75.0](https://github.com/salesforce/sf-pi/compare/v0.74.0...v0.75.0) (2026-05-15)


### Features

* **sf-agentscript:** $latest_* placeholders + version pin + inactive-version preflight ([2316c99](https://github.com/salesforce/sf-pi/commit/2316c9914b8fa650d76127957822e12fb4911146))

## [0.74.0](https://github.com/salesforce/sf-pi/compare/v0.73.0...v0.74.0) (2026-05-15)


### Features

* **sf-agentscript:** trace capture + spec generator + preview vars ([a1c44c8](https://github.com/salesforce/sf-pi/commit/a1c44c8f1dd9377089ec06e729fd529a3221f0b1))

## [0.73.0](https://github.com/salesforce/sf-pi/compare/v0.72.4...v0.73.0) (2026-05-14)


### Features

* **agentscript:** harden local diagnostics and target preflight ([be8ef2c](https://github.com/salesforce/sf-pi/commit/be8ef2c26979595701c70c00801afa0288eda315))

## [0.72.4](https://github.com/salesforce/sf-pi/compare/v0.72.3...v0.72.4) (2026-05-13)


### Bug Fixes

* remaining 5 CodeQL alerts (4 escape sites + 1 redundant null check) ([605fa46](https://github.com/salesforce/sf-pi/commit/605fa46b0d458fcd0287ba4bf1e81c71b5320c0c))

## [0.72.3](https://github.com/salesforce/sf-pi/compare/v0.72.2...v0.72.3) (2026-05-13)


### Bug Fixes

* resolve CodeQL alerts (15 vendored false-fires + 7 real) ([af191e2](https://github.com/salesforce/sf-pi/commit/af191e2b53e37a4cc5571affb6cabb7932595355))

## [0.72.2](https://github.com/salesforce/sf-pi/compare/v0.72.1...v0.72.2) (2026-05-13)


### Bug Fixes

* **sf-welcome:** align Privacy row with checkmark glyph ([5594ac1](https://github.com/salesforce/sf-pi/commit/5594ac1c90ff01c3522b9332e13a45cc9f8cc043))

## [0.72.1](https://github.com/salesforce/sf-pi/compare/v0.72.0...v0.72.1) (2026-05-13)


### Bug Fixes

* **sf-llm-gateway-internal:** track gateway effort/tools validator changes ([75bd878](https://github.com/salesforce/sf-pi/commit/75bd87888bc4f3387857eba401189ce3fc4d7995))

## [0.72.0](https://github.com/salesforce/sf-pi/compare/v0.71.1...v0.72.0) (2026-05-13)


### Features

* **sf-pi-manager:** default-disable pi anonymous install telemetry ([c4ead22](https://github.com/salesforce/sf-pi/commit/c4ead22bb65f0b8a278acb3586b03c5eda479a2f))

## [0.71.1](https://github.com/salesforce/sf-pi/compare/v0.71.0...v0.71.1) (2026-05-13)


### Bug Fixes

* **sf-agentscript:** listPermissionSetAssignments drops namespaced PS rows ([3a8104c](https://github.com/salesforce/sf-pi/commit/3a8104c5595129af9f489dd36f3e1ceaffb6e69f))

## [0.71.0](https://github.com/salesforce/sf-pi/compare/v0.70.0...v0.71.0) (2026-05-13)


### Features

* **sf-agentscript:** activate gains divergence preflight + 'sf project deploy' gotcha doc ([707d3b7](https://github.com/salesforce/sf-pi/commit/707d3b722cc33fb08e40a930e678d52326e17aed))
* **sf-agentscript:** quick-fix for the 'transition ... when "..."' footgun ([b71f5da](https://github.com/salesforce/sf-pi/commit/b71f5dac0ce711f9f2a76f7dacd9a6752ae38353))


### Bug Fixes

* **sf-agentscript:** SFAP-404 wording — transient-first, no false 'org not Agentforce-enabled' claim ([da610ac](https://github.com/salesforce/sf-pi/commit/da610ac56547dabc4a6d6860d61f0e11e4abf513))

## [0.70.0](https://github.com/salesforce/sf-pi/compare/v0.69.0...v0.70.0) (2026-05-13)


### Features

* **sf-agentscript:** provision_agent_user verb — idempotent agent-user setup ([632dd31](https://github.com/salesforce/sf-pi/commit/632dd31be411c698f278a5e25743e54e95749b11))


### Bug Fixes

* **sf-agentscript:** inspect surfaces agent_type on config, not system ([f2e33bb](https://github.com/salesforce/sf-pi/commit/f2e33bbc0513386bc3bc1e60c51a0a926a90d61b))

## [0.69.0](https://github.com/salesforce/sf-pi/compare/v0.68.9...v0.69.0) (2026-05-13)


### Features

* **sf-agentscript:** agent-user lifecycle — status + diagnose verbs ([2a22220](https://github.com/salesforce/sf-pi/commit/2a2222017a6e01ce200676dc19b543592d736f63))
* **sf-agentscript:** scaffold default agent_type — Employee unless agent_user provided ([2366ce0](https://github.com/salesforce/sf-pi/commit/2366ce00587bdf025fa85082e2d8009a07bbdf96))


### Bug Fixes

* **sf-agentscript:** set_field silently no-ops when adding new fields ([d0ea2d0](https://github.com/salesforce/sf-pi/commit/d0ea2d06da3e17ceba085135d392b2156afcf66c))

## [0.68.9](https://github.com/salesforce/sf-pi/compare/v0.68.8...v0.68.9) (2026-05-12)


### Bug Fixes

* **sf-agentscript:** harden preview lifecycle — 4 bugs + diagnostics ([10ed6b4](https://github.com/salesforce/sf-pi/commit/10ed6b4c986342240b3024bbf1fe39fdb331ee0a))

## [0.68.8](https://github.com/salesforce/sf-pi/compare/v0.68.7...v0.68.8) (2026-05-12)


### Bug Fixes

* **deps:** repair package-lock.json drift after dependabot batch merge ([d3edaf4](https://github.com/salesforce/sf-pi/commit/d3edaf457ede2914e1521fe9d779c6387704d438))


### Security

* hard-pin @mistralai/mistralai to 2.2.1 (GHSA-3q49-cfcf-g5fm) ([72942f0](https://github.com/salesforce/sf-pi/commit/72942f02001a586c4e9296be5db3f99798766b1e))

## [0.68.7](https://github.com/salesforce/sf-pi/compare/v0.68.6...v0.68.7) (2026-05-12)


### Bug Fixes

* **sf-llm-gateway:** keep key-conflict warning inside splash ([38fd111](https://github.com/salesforce/sf-pi/commit/38fd1119a9833c1ea6ee1de6a9b93b30c4a99927))

## [0.68.6](https://github.com/salesforce/sf-pi/compare/v0.68.5...v0.68.6) (2026-05-12)


### Performance

* **sf-llm-gateway:** avoid startup model switching ([7773560](https://github.com/salesforce/sf-pi/commit/77735605995efcdb6e3f535c3bde0d2d6aff5c00))
* **sf-llm-gateway:** delay startup footer refresh ([1e8b100](https://github.com/salesforce/sf-pi/commit/1e8b100f12f9104ced7bd18d3a5302f0dc4f7ff3))
* **sf-slack:** use cached identity and scopes during startup ([643214a](https://github.com/salesforce/sf-pi/commit/643214a05dd3cf628ef4afaf71f12a5dae3f2752))

## [0.68.5](https://github.com/salesforce/sf-pi/compare/v0.68.4...v0.68.5) (2026-05-12)


### Performance

* **sf-llm-gateway:** use cached model discovery during startup ([6a1c452](https://github.com/salesforce/sf-pi/commit/6a1c452b6801e775aaed5f59a11f3d38b72e970b))

## [0.68.4](https://github.com/salesforce/sf-pi/compare/v0.68.3...v0.68.4) (2026-05-12)


### Performance

* **sf-welcome:** cache SF CLI status and defer live check ([7e4642c](https://github.com/salesforce/sf-pi/commit/7e4642ce7ae1cb37f190579fc50764c5b5547a16))

## [0.68.3](https://github.com/salesforce/sf-pi/compare/v0.68.2...v0.68.3) (2026-05-12)


### Performance

* **sf-llm-gateway:** do not await footer usage refresh during startup ([342051d](https://github.com/salesforce/sf-pi/commit/342051d2e9a0fb1c1f0e6b99d902e90140ab8b4d))

## [0.68.2](https://github.com/salesforce/sf-pi/compare/v0.68.1...v0.68.2) (2026-05-12)


### Performance

* **sf-slack:** avoid duplicate startup auth probe and defer cache prewarm ([e5f7c99](https://github.com/salesforce/sf-pi/commit/e5f7c99187153531cd7d463b834fe540c4fdebe7))

## [0.68.1](https://github.com/salesforce/sf-pi/compare/v0.68.0...v0.68.1) (2026-05-11)


### Bug Fixes

* **sf-llm-gateway,sf-welcome,sf-devbar:** truthful gateway status + smoother boot + observability ([45a7a46](https://github.com/salesforce/sf-pi/commit/45a7a461c52ab4f77ea99087e55c945666dee662))

## [0.68.0](https://github.com/salesforce/sf-pi/compare/v0.67.0...v0.68.0) (2026-05-11)


### Features

* **sf-agentscript:** pre-flight resolver registry + 6 new schemes ([901e065](https://github.com/salesforce/sf-pi/commit/901e06538651a4c27e8d54908aab88868d24915b))

## [0.67.0](https://github.com/salesforce/sf-pi/compare/v0.66.2...v0.67.0) (2026-05-11)


### Features

* **sf-agentscript:** publish pre-flight for bundleType + action targets ([4f9d7bd](https://github.com/salesforce/sf-pi/commit/4f9d7bdcde6094bf6f4d9f2575e8c38fb9b8e8c2))

## [0.66.2](https://github.com/salesforce/sf-pi/compare/v0.66.1...v0.66.2) (2026-05-11)


### Bug Fixes

* **sf-conn:** map Salesforce errorCode strings to HTTP status in connRequest ([9d98012](https://github.com/salesforce/sf-pi/commit/9d98012d5c0c5f1a63eaf1cdf5384f7fedc1771f))

## [0.66.1](https://github.com/salesforce/sf-pi/compare/v0.66.0...v0.66.1) (2026-05-11)


### Bug Fixes

* **sf-data360, sf-conn:** harden d360 tools against cross-org API version + body double-encoding ([75e3626](https://github.com/salesforce/sf-pi/commit/75e36263611f28722b8c64c59f41ead10a717adf))

## [0.66.0](https://github.com/salesforce/sf-pi/compare/v0.65.2...v0.66.0) (2026-05-11)


### Features

* **sf-conn:** wire connection-cache lifecycle into sf-data360 + shared runtime ([a13cec1](https://github.com/salesforce/sf-pi/commit/a13cec1e53759e12cb7ab37d7416fc103a073edc))


### Performance

* **sf-data360:** parallelize d360_probe with Promise.all ([1947cc1](https://github.com/salesforce/sf-pi/commit/1947cc19741329cdcc6773e0484df85a905eff0f))

## [0.65.2](https://github.com/salesforce/sf-pi/compare/v0.65.1...v0.65.2) (2026-05-11)


### Performance

* **sf-data360:** replace 'sf api request rest' subprocess with @salesforce/core Connection ([8c6d210](https://github.com/salesforce/sf-pi/commit/8c6d210745048521061c4d93a4991850b2b35587))
* **sf-welcome:** swap 'npm view' subprocess for direct registry fetch ([b56c8cb](https://github.com/salesforce/sf-pi/commit/b56c8cb08177ba5a7ce584875328ded8d45bc6f9))

## [0.65.1](https://github.com/salesforce/sf-pi/compare/v0.65.0...v0.65.1) (2026-05-11)


### Performance

* **sf-environment:** drop subprocess from detectConfig + detectOrg ([7f067a4](https://github.com/salesforce/sf-pi/commit/7f067a407bb31e11c8aa88374ebdd2150c02dea3))

## [0.65.0](https://github.com/salesforce/sf-pi/compare/v0.64.0...v0.65.0) (2026-05-11)


### Features

* **sf-agentscript:** recipe lifecycle harness + SDR layout hardening ([c5d2d41](https://github.com/salesforce/sf-pi/commit/c5d2d41e0fd8e13af1139a9a42f22968fb19bd98))

## [0.64.0](https://github.com/salesforce/sf-pi/compare/v0.63.0...v0.64.0) (2026-05-11)


### Features

* **sf-agentscript:** saved Markdown reports + /sf-agentscript report (Phase 5) ([991e8e5](https://github.com/salesforce/sf-pi/commit/991e8e5878abffa958d52888778f22a0fb215fe2))

## [0.63.0](https://github.com/salesforce/sf-pi/compare/v0.62.0...v0.63.0) (2026-05-11)


### Features

* **sf-agentscript:** rich rendering for compile, inspect, mutate (Phase 2) ([a7be1b0](https://github.com/salesforce/sf-pi/commit/a7be1b097bedfe33f2564fd04de28318213f2842))

## [0.62.0](https://github.com/salesforce/sf-pi/compare/v0.61.3...v0.62.0) (2026-05-11)


### Features

* **sf-agentscript:** rich timeline waterfall renderer for preview send ([0742cee](https://github.com/salesforce/sf-pi/commit/0742ceed6f5ea91376446d9faf0733495a3a3e15))

## [0.61.3](https://github.com/salesforce/sf-pi/compare/v0.61.2...v0.61.3) (2026-05-11)


### Bug Fixes

* **sf-agentscript:** defensive write that rolls back AST emit regressions ([68846c4](https://github.com/salesforce/sf-pi/commit/68846c44e371fba9cee7a262ea27212c0794acee))

## [0.61.2](https://github.com/salesforce/sf-pi/compare/v0.61.1...v0.61.2) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** use SDR ComponentSet to deploy AiAuthoringBundle (both files, like the CLI) ([49392c9](https://github.com/salesforce/sf-pi/commit/49392c9f3e6eb0fea2981656eb8a84b575a8eedb))

## [0.61.1](https://github.com/salesforce/sf-pi/compare/v0.61.0...v0.61.1) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** deploy AiAuthoringBundle so published agents open in Agent Script Studio ([d121e9f](https://github.com/salesforce/sf-pi/commit/d121e9f10d96d86a5b339b60112053ad93e9d4e3))

## [0.61.0](https://github.com/salesforce/sf-pi/compare/v0.60.0...v0.61.0) (2026-05-10)


### Features

* **sf-agentscript:** production-agent v1 surface digest ([a26ff14](https://github.com/salesforce/sf-pi/commit/a26ff14dc4e9d89a9e8a57892091bcb28bc9e64c))

## [0.60.0](https://github.com/salesforce/sf-pi/compare/v0.59.0...v0.60.0) (2026-05-10)


### Features

* **sf-agentscript:** rich planner-trace digest for LLM self-recovery ([bbeca78](https://github.com/salesforce/sf-pi/commit/bbeca78db42aff5bbc42cf1d7ab6de0029191a8b))

## [0.59.0](https://github.com/salesforce/sf-pi/compare/v0.58.6...v0.59.0) (2026-05-10)


### Features

* **sf-agentscript:** hardening items 1, 2, 4 ([0a69cd4](https://github.com/salesforce/sf-pi/commit/0a69cd4da902f23377298e906e96f83caab1e5aa))

## [0.58.6](https://github.com/salesforce/sf-pi/compare/v0.58.5...v0.58.6) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** two hardening bugs found by official agentscript fixtures ([70a8119](https://github.com/salesforce/sf-pi/commit/70a81198c38effb3971c2b9ca0fde14f997fce42))

## [0.58.5](https://github.com/salesforce/sf-pi/compare/v0.58.4...v0.58.5) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** restore default actions and print full preview session ids ([821e5d8](https://github.com/salesforce/sf-pi/commit/821e5d8c891b020425b73fa614177662f4bbe804))

## [0.58.4](https://github.com/salesforce/sf-pi/compare/v0.58.3...v0.58.4) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** use named-user JWT for Agent API routes ([f737725](https://github.com/salesforce/sf-pi/commit/f7377256d887b5b4ff0572b9384086d993de0a13))

## [0.58.3](https://github.com/salesforce/sf-pi/compare/v0.58.2...v0.58.3) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** pair send_message↔get_state by execution order ([8456175](https://github.com/salesforce/sf-pi/commit/8456175ba9f49102048f1e4fe6b722d12d508d41))

## [0.58.2](https://github.com/salesforce/sf-pi/compare/v0.58.1...v0.58.2) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** transcript + FailureRecord utterance cross-reference ([5594b2a](https://github.com/salesforce/sf-pi/commit/5594b2adf3b9a8b419baf387dc17606ed967d561))

## [0.58.1](https://github.com/salesforce/sf-pi/compare/v0.58.0...v0.58.1) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** bugs found during AgentforceTesting smoke pass ([2d1f0fb](https://github.com/salesforce/sf-pi/commit/2d1f0fb2db30f4cb9eceeedb36cd7becaf5dbf45))

## [0.58.0](https://github.com/salesforce/sf-pi/compare/v0.57.1...v0.58.0) (2026-05-10)


### Features

* **sf-agentscript:** P8 — lifecycle + tier-2 IQ unlocks (7 tools) ([37dff3d](https://github.com/salesforce/sf-pi/commit/37dff3dadb02785513dd5e78c6d867909a08f6fa))

## [0.57.1](https://github.com/salesforce/sf-pi/compare/v0.57.0...v0.57.1) (2026-05-10)


### Bug Fixes

* **sf-agentscript:** set_field value-wrapping + sharper failure kinds + skill polish ([ad63785](https://github.com/salesforce/sf-pi/commit/ad63785e4bb890229af2ca04e2be48828abefb80))

## [0.57.0](https://github.com/salesforce/sf-pi/compare/v0.56.1...v0.57.0) (2026-05-10)


### Features

* **sf-agentscript:** P1 — six-pass eval normalizer ([b796a49](https://github.com/salesforce/sf-pi/commit/b796a496e542f577b510b685693976f59a90ca09))
* **sf-agentscript:** P2 — inspect + mutate tools ([c08faca](https://github.com/salesforce/sf-pi/commit/c08faca5d1da641850ac195680893b796b0645d6))
* **sf-agentscript:** P3 — cut eval orchestrator over to @salesforce/core Connection ([94a9df8](https://github.com/salesforce/sf-pi/commit/94a9df8f409fa195703fff17d038e7b7b8741f63))
* **sf-agentscript:** P4 — collapse 4 eval tools into agentscript_eval ([4314079](https://github.com/salesforce/sf-pi/commit/4314079c33ab4c6e70f72edd4552611bb688f2fd))
* **sf-agentscript:** P5 — preview client + agentscript_preview tool ([ee5ae5a](https://github.com/salesforce/sf-pi/commit/ee5ae5a765136cd72672e0d1eb062d4c94e1af3c))
* **sf-agentscript:** P6 — agentscript_create + delete vendored .d.ts ([ea630fa](https://github.com/salesforce/sf-pi/commit/ea630fa582cb96511dfe166de96f7856d6a72fe2))
* **sf-agentscript:** P7 — local-first wiring + doctor + e2e self-recovery test ([653f2f4](https://github.com/salesforce/sf-pi/commit/653f2f4ad6f5816e4567db0cd686b232f244f63b))
* **sf-agentscript:** rename + Phase 0 foundation ([73a1114](https://github.com/salesforce/sf-pi/commit/73a111447d5c02e1b8324fce038ac9c3dab6c4c7))


### Bug Fixes

* **sf-agentscript:** commit vendored browser.js (gitignore allowlist had stale path) ([ca36f63](https://github.com/salesforce/sf-pi/commit/ca36f6355896f87a29538242e67c3f969d38b759))

## [0.56.1](https://github.com/salesforce/sf-pi/compare/v0.56.0...v0.56.1) (2026-05-10)


### Bug Fixes

* **sf-environment:** list all active tools verbatim in agent context ([28bdfb1](https://github.com/salesforce/sf-pi/commit/28bdfb1ebea15e723b68ffcda0c89102b9406eea))

## [0.56.0](https://github.com/salesforce/sf-pi/compare/v0.55.9...v0.56.0) (2026-05-09)


### Features

* **panel:** single-place credentials per integration (ADR 0007) ([c72cae9](https://github.com/salesforce/sf-pi/commit/c72cae9b207645748f0327f87874acf3f9da8593))

## [0.55.9](https://github.com/salesforce/sf-pi/compare/v0.55.8...v0.55.9) (2026-05-09)


### Bug Fixes

* **panel:** prettier format safe-command-handler.test.ts ([02a88a7](https://github.com/salesforce/sf-pi/commit/02a88a7398a04a187080db3fbd9d355277a40715))
* **panel:** wrap every /sf-* slash-command handler so failures surface visibly ([ddb6ffb](https://github.com/salesforce/sf-pi/commit/ddb6ffb9b716c0ca290718edb545996727defbc7))

## [0.55.8](https://github.com/salesforce/sf-pi/compare/v0.55.7...v0.55.8) (2026-05-09)


### Bug Fixes

* **panel:** consistency for /sf-org and /sf-fonts; harden panel against silent hangs ([a62dae5](https://github.com/salesforce/sf-pi/commit/a62dae5341c0b92f2ffb9b840e620bbda17670b9))

## [0.55.7](https://github.com/salesforce/sf-pi/compare/v0.55.6...v0.55.7) (2026-05-09)


### Bug Fixes

* **panel:** close-row dismisses panel; toggle.lifecycle closes before reload ([45c1025](https://github.com/salesforce/sf-pi/commit/45c10251c3e82040481baca7afc8f94d6cf1f9ae))

## [0.55.6](https://github.com/salesforce/sf-pi/compare/v0.55.5...v0.55.6) (2026-05-09)


### Bug Fixes

* **sf-slack:** use node:https instead of undici fetch (Node 26 H2 hang) ([3e8ebd1](https://github.com/salesforce/sf-pi/commit/3e8ebd1b84d0980e77c2cade5c900118e528c333))

## [0.55.5](https://github.com/salesforce/sf-pi/compare/v0.55.4...v0.55.5) (2026-05-09)


### Bug Fixes

* **sf-slack:** force HTTP/1.1 to avoid undici H2 hang on Node 26 ([0635c15](https://github.com/salesforce/sf-pi/commit/0635c15908bc91a1308ac8cee8dee554b3a13724))

## [0.55.4](https://github.com/salesforce/sf-pi/compare/v0.55.3...v0.55.4) (2026-05-09)


### Bug Fixes

* **sf-slack:** bail session_start when auth.test returns ok:false ([8bb629e](https://github.com/salesforce/sf-pi/commit/8bb629e2edc4bb6f308647e67d64fbf73b20142f))

## [0.55.3](https://github.com/salesforce/sf-pi/compare/v0.55.2...v0.55.3) (2026-05-09)


### Bug Fixes

* **sf-slack:** surface the actual error when auth/scope-probe fails ([69688a0](https://github.com/salesforce/sf-pi/commit/69688a0cc648064b88d64ec06fb7fcfeb6829e05))

## [0.55.2](https://github.com/salesforce/sf-pi/compare/v0.55.1...v0.55.2) (2026-05-09)


### Bug Fixes

* **sf-slack:** surface auth.test timeout instead of staying stuck on loading ([4573234](https://github.com/salesforce/sf-pi/commit/45732342bd55192d685ecc151289dbb604bd2a31))

## [0.55.1](https://github.com/salesforce/sf-pi/compare/v0.55.0...v0.55.1) (2026-05-09)


### Bug Fixes

* **release:** cut patch release for Wave 3 refactors ([e4434b0](https://github.com/salesforce/sf-pi/commit/e4434b0b729d591a14ebfd59bd1aaac8a03562b0))

## [0.55.0](https://github.com/salesforce/sf-pi/compare/v0.54.0...v0.55.0) (2026-05-09)


### Features

* ADR 0006 closing follow-ups ([fd7591c](https://github.com/salesforce/sf-pi/commit/fd7591c2805db97a386d3f0ac0577e0127c17d1a))

## [0.54.0](https://github.com/salesforce/sf-pi/compare/v0.53.0...v0.54.0) (2026-05-09)


### Features

* state-store + /sf-pi doctor aggregation ([2997309](https://github.com/salesforce/sf-pi/commit/29973095f3eeb4fbee9aa1aa66c8b4113bae1bfe))

## [0.53.0](https://github.com/salesforce/sf-pi/compare/v0.52.0...v0.53.0) (2026-05-09)


### Features

* extension consistency baseline (ADR 0006) ([bce5d53](https://github.com/salesforce/sf-pi/commit/bce5d536d9db6768ed620a24dbbef13a37879523))

## [0.52.0](https://github.com/salesforce/sf-pi/compare/v0.51.1...v0.52.0) (2026-05-09)


### ⚠ BREAKING CHANGES

* migrate pi peer-dep scope from @mariozechner to @earendil-works (pi 0.74) ([#94](https://github.com/salesforce/sf-pi/issues/94))

### Features

* migrate pi peer-dep scope from [@mariozechner](https://github.com/mariozechner) to [@earendil-works](https://github.com/earendil-works) (pi 0.74) ([#94](https://github.com/salesforce/sf-pi/issues/94)) ([5082638](https://github.com/salesforce/sf-pi/commit/5082638935b7f0afeb892e7ed86a8909040778a0))


### Bug Fixes

* **ci:** grant statuses:write to auto-merge-release-pr job ([#96](https://github.com/salesforce/sf-pi/issues/96)) ([36979d0](https://github.com/salesforce/sf-pi/commit/36979d060a1dc022e5b07346370bbeb8bbcd73ff))

## [0.51.1](https://github.com/salesforce/sf-pi/compare/v0.51.0...v0.51.1) (2026-05-09)


### Bug Fixes

* **sf-feedback:** anchor github.com host check in sanitizeRemoteUrl ([c39267d](https://github.com/salesforce/sf-pi/commit/c39267d91544b60d0e5eb2d8100ac07f275ed6e3))

## [0.51.0](https://github.com/salesforce/sf-pi/compare/v0.50.0...v0.51.0) (2026-05-09)


### Features

* **panels:** drift migrations \u2014 sf-lsp, sf-llm-gateway-internal, sf-welcome ([e2bd0e4](https://github.com/salesforce/sf-pi/commit/e2bd0e467d3e8da7cfa3bb2383aa31d4e2ab92dc))
* **panels:** lint script + scaffold template + AGENTS.md contract ([9ac3e57](https://github.com/salesforce/sf-pi/commit/9ac3e57aa686ed64b152dbf8c154d57f8e8c98bd))
* **panels:** shared lifecycle toggle action + sf-data360 popup output ([bdc313d](https://github.com/salesforce/sf-pi/commit/bdc313d1dce27c6b770ba5893c729f04f612eb22))
* **ui:** four-color hierarchy + exit/quit keys for shared command panel ([6dbdeda](https://github.com/salesforce/sf-pi/commit/6dbdedab4716efbbdc5f28537708403aba9f7956))


### Bug Fixes

* **sf-pi-manager,sf-data360:** consistent scope auto-detect + standardized /sf-data360 panel ([7620539](https://github.com/salesforce/sf-pi/commit/7620539bb503ae4ffdbab57ad4d26e12ce813646))

## [0.50.0](https://github.com/salesforce/sf-pi/compare/v0.49.0...v0.50.0) (2026-05-09)


### Features

* **sf-data360:** release verified payload shapes for 13 entity lifecycles ([5045317](https://github.com/salesforce/sf-pi/commit/5045317e1343e5c9db9068ff4c3a20ff80e0ea55))

## [0.49.0](https://github.com/salesforce/sf-pi/compare/v0.48.1...v0.49.0) (2026-05-09)


### Features

* **sf-data360:** improve recursive validation guidance ([c938f74](https://github.com/salesforce/sf-pi/commit/c938f747e226536c51c1cfd4e520372f68915e8c))

## [0.48.1](https://github.com/salesforce/sf-pi/compare/v0.48.0...v0.48.1) (2026-05-08)


### Bug Fixes

* **sf-data360:** harden mutating Data 360 workflows ([b977a5f](https://github.com/salesforce/sf-pi/commit/b977a5f8f3615806b5850f97a0fc3948e87f165b))

## [0.48.0](https://github.com/salesforce/sf-pi/compare/v0.47.1...v0.48.0) (2026-05-08)


### Features

* **gateway:** streamline sf llm gateway setup ([92cefb5](https://github.com/salesforce/sf-pi/commit/92cefb5a16eee4f7c33f35b85e19d940f669bd5c))


### Bug Fixes

* **data360:** clean cli output and cap metadata lists ([c5dd332](https://github.com/salesforce/sf-pi/commit/c5dd332241fe32bb14fb4cf4e6f2e57ba9077f8d))

## [0.47.1](https://github.com/salesforce/sf-pi/compare/v0.47.0...v0.47.1) (2026-05-07)


### Bug Fixes

* **sf-data360:** improve DLO metadata summaries ([680bd0b](https://github.com/salesforce/sf-pi/commit/680bd0bb1bbbdcdfa9afdb091249c0c8ea6f3e8c))

## [0.47.0](https://github.com/salesforce/sf-pi/compare/v0.46.2...v0.47.0) (2026-05-07)


### Features

* **sf-data360:** add compact metadata helper ([fac9c51](https://github.com/salesforce/sf-pi/commit/fac9c513f27493b33ff72ae2bd3989e0ff06eee9))

## [0.46.2](https://github.com/salesforce/sf-pi/compare/v0.46.1...v0.46.2) (2026-05-07)


### Bug Fixes

* **sf-slack:** improve scope gating and partial-grant UX ([df59889](https://github.com/salesforce/sf-pi/commit/df59889bdb2355b87114a72ecc33e730ab81c075))

## [0.46.1](https://github.com/salesforce/sf-pi/compare/v0.46.0...v0.46.1) (2026-05-07)


### Bug Fixes

* **sf-slack:** show partial scope grants as connected ([bec6924](https://github.com/salesforce/sf-pi/commit/bec692462d7467b5a30b86f34ba72ed4a8b039d3))

## [0.46.0](https://github.com/salesforce/sf-pi/compare/v0.45.3...v0.46.0) (2026-05-07)


### Features

* add opt-in Data 360 REST helper ([3556c9a](https://github.com/salesforce/sf-pi/commit/3556c9a70832408cf0dcf4dcf8605ebb3bce5b28))

## [0.45.3](https://github.com/salesforce/sf-pi/compare/v0.45.2...v0.45.3) (2026-05-07)


### Bug Fixes

* **sf-llm-gateway-internal:** strengthen gateway status diagnostics ([a84055f](https://github.com/salesforce/sf-pi/commit/a84055f8751dda826c8a234b8edef178eb11f93f))

## [0.45.2](https://github.com/salesforce/sf-pi/compare/v0.45.1...v0.45.2) (2026-05-06)


### Bug Fixes

* **sf-slack:** consolidate send confirmation ([d388670](https://github.com/salesforce/sf-pi/commit/d388670effe0d2ac1890bb3b9c7c0cfa3dff9b80))

## [0.45.1](https://github.com/salesforce/sf-pi/compare/v0.45.0...v0.45.1) (2026-05-06)


### Bug Fixes

* **sf-slack:** reuse existing dm channels without im write ([6218abc](https://github.com/salesforce/sf-pi/commit/6218abcdd198f9b96806ca73d4a1255d0405d5e0))

## [0.45.0](https://github.com/salesforce/sf-pi/compare/v0.44.1...v0.45.0) (2026-05-06)


### Features

* **ui:** improve command panel interactions ([91a546f](https://github.com/salesforce/sf-pi/commit/91a546f72935f11a0d94b3191f999762abfb767c))


### Bug Fixes

* **ui:** refine panels and popup contrast ([16423f3](https://github.com/salesforce/sf-pi/commit/16423f3a298aed9d64ecf6feb862d756c284843c))

## [0.44.1](https://github.com/salesforce/sf-pi/compare/v0.44.0...v0.44.1) (2026-05-06)


### Bug Fixes

* **sf-slack:** strengthen canvas scope degradation ([9e36a6b](https://github.com/salesforce/sf-pi/commit/9e36a6bff98af91e1dd8b6ed303792e819fb7e27))

## [0.44.0](https://github.com/salesforce/sf-pi/compare/v0.43.0...v0.44.0) (2026-05-05)


### Features

* standardize extension command panels ([1db5cd4](https://github.com/salesforce/sf-pi/commit/1db5cd4b3b5ba7e866158616a1dbe903194be8a9))

## [0.43.0](https://github.com/salesforce/sf-pi/compare/v0.42.0...v0.43.0) (2026-05-05)


### Features

* **sf-llm-gateway-internal:** route gpt-5 and gpt-5-mini through /responses ([#68](https://github.com/salesforce/sf-pi/issues/68)) ([a1b56f8](https://github.com/salesforce/sf-pi/commit/a1b56f857059a38c4d875765413efad9a9588814))
* **sf-llm-gateway-internal:** route gpt-5.5 through OpenAI Responses API ([#66](https://github.com/salesforce/sf-pi/issues/66)) ([28714dd](https://github.com/salesforce/sf-pi/commit/28714dd7bff2fe22491e3b8937e61d7c2b0bcbaa))

## [0.42.0](https://github.com/salesforce/sf-pi/compare/v0.41.4...v0.42.0) (2026-05-05)


### Features

* **sf-llm-gateway-internal:** daily activity, token counter, SSO onboarding, drift detection ([#63](https://github.com/salesforce/sf-pi/issues/63)) ([9577031](https://github.com/salesforce/sf-pi/commit/9577031c83f4ad472dc40a06b5b141c27e2137f5))

## [0.41.4](https://github.com/salesforce/sf-pi/compare/v0.41.3...v0.41.4) (2026-05-05)


### Bug Fixes

* ignore arrow escape sequences in gateway setup ([dde946d](https://github.com/salesforce/sf-pi/commit/dde946d64de4fe8b0b4f8324119e83e303e489d9))

## [0.41.3](https://github.com/salesforce/sf-pi/compare/v0.41.2...v0.41.3) (2026-05-05)


### Bug Fixes

* hide optional integration status until active ([2542176](https://github.com/salesforce/sf-pi/commit/2542176c01319bd32a51a72b5a53c449b7e91844))
* make gateway preflight status truthful ([3a04d8c](https://github.com/salesforce/sf-pi/commit/3a04d8c6814f9ec8a6c445562e1c7c48cdd9c99b))

## [0.41.2](https://github.com/salesforce/sf-pi/compare/v0.41.1...v0.41.2) (2026-05-05)


### Bug Fixes

* **sf-llm-gateway-internal:** simplify gateway setup recovery ([e4ea963](https://github.com/salesforce/sf-pi/commit/e4ea963d6fb7b62d6eef6f4b851b82e72a310320))

## [0.41.1](https://github.com/salesforce/sf-pi/compare/v0.41.0...v0.41.1) (2026-05-05)


### Bug Fixes

* **sf-pi:** include npm release-age bypass in runtime doctor ([f094227](https://github.com/salesforce/sf-pi/commit/f094227cb277bce724570fc78fd9109207742139))

## [0.41.0](https://github.com/salesforce/sf-pi/compare/v0.40.0...v0.41.0) (2026-05-05)


### Features

* **sf-pi:** add runtime and gateway doctor preflights ([9de6b78](https://github.com/salesforce/sf-pi/commit/9de6b7881c14fcce0c84c8a5ffc66cd50e37d756))


### Bug Fixes

* **sf-llm-gateway-internal:** handle bedrock gateway root routing ([0559c95](https://github.com/salesforce/sf-pi/commit/0559c956d842726d0a354e0a1d49068c5ae22260))

## [0.40.0](https://github.com/salesforce/sf-pi/compare/v0.39.0...v0.40.0) (2026-05-05)


### Features

* add aggregate metrics and npm publishing ([a113f4b](https://github.com/salesforce/sf-pi/commit/a113f4b0fc5cb135a0d66e72b9ded20aad6aa080))

## [0.39.0](https://github.com/salesforce/sf-pi/compare/v0.38.1...v0.39.0) (2026-05-04)


### Features

* add sf feedback extension ([330c1a3](https://github.com/salesforce/sf-pi/commit/330c1a3725087bd7e21dbe68c1d1f367aabc4cdb))

## [0.38.1](https://github.com/salesforce/sf-pi/compare/v0.38.0...v0.38.1) (2026-05-04)


### Bug Fixes

* release pi 0.73 compatibility update ([1137b28](https://github.com/salesforce/sf-pi/commit/1137b2866996df11f2eae21ff64e7f4db0a6f1fe))

## [0.38.0](https://github.com/salesforce/sf-pi/compare/v0.37.4...v0.38.0) (2026-05-04)


### Features

* add sf-pi doctor self-healing ([6fa1b42](https://github.com/salesforce/sf-pi/commit/6fa1b42c1f47a8572056d71f67ef46192d3a7173))

## [0.37.4](https://github.com/salesforce/sf-pi/compare/v0.37.3...v0.37.4) (2026-05-04)


### Bug Fixes

* **sf-welcome:** smooth startup hydration ([1f6eec0](https://github.com/salesforce/sf-pi/commit/1f6eec0b49bb43592e15a287641632c5a2f94423))

## [0.37.3](https://github.com/salesforce/sf-pi/compare/v0.37.2...v0.37.3) (2026-05-04)


### Bug Fixes

* **sf-welcome:** animate and auto-dismiss quiet header ([690e9f7](https://github.com/salesforce/sf-pi/commit/690e9f7e1769fda680ecf9e180efc0ccabc14daa))

## [0.37.2](https://github.com/salesforce/sf-pi/compare/v0.37.1...v0.37.2) (2026-05-04)


### Bug Fixes

* **security:** address CodeQL scanning alerts ([#48](https://github.com/salesforce/sf-pi/issues/48)) ([308800c](https://github.com/salesforce/sf-pi/commit/308800c5f6591a47519cab1e401b61ce9285d363))

## [0.37.1](https://github.com/salesforce/sf-pi/compare/v0.37.0...v0.37.1) (2026-05-04)


### Bug Fixes

* **sf-welcome:** align splash status rows ([133d8c0](https://github.com/salesforce/sf-pi/commit/133d8c089c6eb0aafe941f07d1bc2f2a4a4d965d))
* **ui:** improve ascii glyph fallbacks ([dbb1de6](https://github.com/salesforce/sf-pi/commit/dbb1de63ef08bee68677a84d3035528c1d1e4afb))

## [0.37.0](https://github.com/salesforce/sf-pi/compare/v0.36.0...v0.37.0) (2026-05-04)


### Features

* **sf-welcome:** refine splash recommendations ([e2ce484](https://github.com/salesforce/sf-pi/commit/e2ce484050792ec6429529c9da895d200ade03aa))

## [0.36.0](https://github.com/salesforce/sf-pi/compare/v0.35.0...v0.36.0) (2026-05-04)


### Features

* **sf-devbar:** update footer layout ([60eb7d5](https://github.com/salesforce/sf-pi/commit/60eb7d550bde8c758255a47c567afc1df674415d))

## [0.35.0](https://github.com/salesforce/sf-pi/compare/v0.34.0...v0.35.0) (2026-05-04)


### Features

* **sf-welcome:** simplify CLI status ([893159f](https://github.com/salesforce/sf-pi/commit/893159fd8ca2dbb70c8a6cf3d02bf475bf418f5c))

## [0.34.0](https://github.com/salesforce/sf-pi/compare/v0.33.1...v0.34.0) (2026-05-03)


### Features

* **docs:** automate documentation health checks ([ab14348](https://github.com/salesforce/sf-pi/commit/ab143481d218f386faa61023ca589c124aa84994))

## [0.33.1](https://github.com/salesforce/sf-pi/compare/v0.33.0...v0.33.1) (2026-05-03)


### Bug Fixes

* **sf-llm-gateway-internal:** make gpt-5.5 agentic-safe ([abf7dc0](https://github.com/salesforce/sf-pi/commit/abf7dc054307e74dce77d74d9e0c1662d186936b))

## [0.33.0](https://github.com/salesforce/sf-pi/compare/v0.32.0...v0.33.0) (2026-05-03)


### Features

* **gateway:** maximize OpenAI reasoning defaults ([35af5d4](https://github.com/salesforce/sf-pi/commit/35af5d4ba007c58d53888f5c3e82628b5f92d0ef))


### Bug Fixes

* **sf-welcome:** caption copy + force animation repaints ([902c240](https://github.com/salesforce/sf-pi/commit/902c240192d36311e981b542167d14b71dcb985a))

## [0.32.0](https://github.com/salesforce/sf-pi/compare/v0.31.3...v0.32.0) (2026-05-03)


### Features

* **sf-welcome:** animated Pi + SALESFORCE brand mark with dual palette ([7f2a698](https://github.com/salesforce/sf-pi/commit/7f2a698c90ee91322671769b0c64f34f1b9fe323))

## [0.31.3](https://github.com/salesforce/sf-pi/compare/v0.31.2...v0.31.3) (2026-05-03)


### Bug Fixes

* **ci:** dispatch every required-check workflow on release PR branch ([9ad56aa](https://github.com/salesforce/sf-pi/commit/9ad56aa5e426ce3856a5232fe7a6862fad348e67))

## [0.31.2](https://github.com/salesforce/sf-pi/compare/v0.31.1...v0.31.2) (2026-05-03)


### Bug Fixes

* **ci:** catch missing SPDX headers at pre-commit ([636f9ff](https://github.com/salesforce/sf-pi/commit/636f9ff5d72c290899264c8951061dc67e551125))
* **ci:** use gh pr merge --auto to unblock release PR auto-merge ([a3400fb](https://github.com/salesforce/sf-pi/commit/a3400fb32963492d68d213d9528a193be66458ef))
* **scripts:** make validate.sh agent-friendly ([390e026](https://github.com/salesforce/sf-pi/commit/390e02610dda66b4f0ef2c35ee964f4ad1fb34e9))
* **security:** address zizmor workflow hardening findings ([01137b9](https://github.com/salesforce/sf-pi/commit/01137b9b812e393d8a4818487cb72dcd938e378a))

## [0.31.1](https://github.com/salesforce/sf-pi/compare/v0.31.0...v0.31.1) (2026-05-03)


### Bug Fixes

* **ci:** add SPDX header to render-splash-header.mjs ([96b64ea](https://github.com/salesforce/sf-pi/commit/96b64ea73938942db9070b36996ccf7935daa2d3))

## [0.31.0](https://github.com/salesforce/sf-pi/compare/v0.30.0...v0.31.0) (2026-05-03)


### Features

* **sf-welcome:** Pi + SF brand mark with Salesforce Headless 360 caption ([bea6e2f](https://github.com/salesforce/sf-pi/commit/bea6e2fccd212cdf97e5d090fa9b4f615a2a75fe))

## [0.30.0](https://github.com/salesforce/sf-pi/compare/v0.29.0...v0.30.0) (2026-05-03)


### Features

* **sf-pi-manager:** /sf-pi skills for Claude Code / Codex / Cursor interop ([044bdcd](https://github.com/salesforce/sf-pi/commit/044bdcd7aaa537831df68dcf08a06d0db22cec2a))


### Bug Fixes

* **sf-welcome:** detect pi-skills and other git: clones in skill roots ([044bdcd](https://github.com/salesforce/sf-pi/commit/044bdcd7aaa537831df68dcf08a06d0db22cec2a))

## [0.29.0](https://github.com/salesforce/sf-pi/compare/v0.28.2...v0.29.0) (2026-05-03)


### Features

* **sf-guardrail:** Salesforce-aware safety layer for tool_call ([59752b9](https://github.com/salesforce/sf-pi/commit/59752b924e6b587da1589ec89055d5e11b190a34))

## [0.28.2](https://github.com/salesforce/sf-pi/compare/v0.28.1...v0.28.2) (2026-05-03)


### Bug Fixes

* **sf-devbar:** wrap LSP health segment in LSP[…] label ([15032e0](https://github.com/salesforce/sf-pi/commit/15032e0b5b96a84faebf3b8c7e427498c68cb4fb))

## [0.28.1](https://github.com/salesforce/sf-pi/compare/v0.28.0...v0.28.1) (2026-05-03)


### Bug Fixes

* **sf-lsp:** respect externally-provided LSP servers in install prompt ([fabcbac](https://github.com/salesforce/sf-pi/commit/fabcbac2910e366568bf714e00c83242169f217e))

## [0.28.0](https://github.com/salesforce/sf-pi/compare/v0.27.6...v0.28.0) (2026-05-03)


### Features

* **sf-lsp:** first-boot auto-install for Apex + LWC language servers ([8d916d1](https://github.com/salesforce/sf-pi/commit/8d916d1e9ce3e679fc50a48f6bc5052aceb37981))

## [0.27.6](https://github.com/salesforce/sf-pi/compare/v0.27.5...v0.27.6) (2026-05-02)


### Bug Fixes

* **sf-slack:** serialize slack_resolve clarify dialogs across parallel calls ([d4b17ea](https://github.com/salesforce/sf-pi/commit/d4b17eadf4914966a8c3872bd0194dc27a59ac43))

## [0.27.5](https://github.com/salesforce/sf-pi/compare/v0.27.4...v0.27.5) (2026-05-02)


### Performance

* **sf-slack:** parallelize thread fetch, trim channel discovery, raise concurrency ([4d54823](https://github.com/salesforce/sf-pi/commit/4d54823429bb3417efe400faac28309c69fe5c0a))

## [0.27.4](https://github.com/salesforce/sf-pi/compare/v0.27.3...v0.27.4) (2026-05-02)


### Bug Fixes

* **sf-slack:** bound Slack API calls with per-request + per-operation timeouts ([099e8b3](https://github.com/salesforce/sf-pi/commit/099e8b388cca53a001c805c0953e5f62bc8efd52)), closes [#17](https://github.com/salesforce/sf-pi/issues/17)

## [0.27.3](https://github.com/salesforce/sf-pi/compare/v0.27.2...v0.27.3) (2026-05-02)


### Bug Fixes

* **sf-lsp-health:** drop non-null assertion in getRegistry ([208d98c](https://github.com/salesforce/sf-pi/commit/208d98c58b9905d86a1daf30d95fb5144b67d10d))

## [0.27.2](https://github.com/salesforce/sf-pi/compare/v0.27.1...v0.27.2) (2026-05-02)


### Bug Fixes

* **sf-lsp-health:** pin registry on globalThis to cross extension module graphs ([3fc4105](https://github.com/salesforce/sf-pi/commit/3fc41053ff2e29aafcee0f590484d0e91ac3f32e))

## [0.27.1](https://github.com/salesforce/sf-pi/compare/v0.27.0...v0.27.1) (2026-05-02)


### Bug Fixes

* **sf-devbar:** LSP segment stuck on 'unknown' after session start ([2bf34e0](https://github.com/salesforce/sf-pi/commit/2bf34e0dad332a4385588197e088552572e805cf))

## [0.27.0](https://github.com/salesforce/sf-pi/compare/v0.26.1...v0.27.0) (2026-05-02)


### Features

* **sf-lsp,sf-devbar:** richer top-bar glyphs blending availability + activity ([6b49ac2](https://github.com/salesforce/sf-pi/commit/6b49ac2d7fb89cda1f812c993a002d8393a45b1e))


### Bug Fixes

* **sf-lsp:** flush-right HUD, show devbar pill, configurable icon ([839dfc0](https://github.com/salesforce/sf-pi/commit/839dfc0831c24cdd6b0706c9fd0954453e6b76fd))

## [0.26.1](https://github.com/salesforce/sf-pi/compare/v0.26.0...v0.26.1) (2026-05-02)


### Bug Fixes

* **sf-lsp:** drop in-card edit/write tool renderer to resolve Pi load conflict ([468a51c](https://github.com/salesforce/sf-pi/commit/468a51c7844878b74d701f816eda3ad391728b9e))

## [0.26.0](https://github.com/salesforce/sf-pi/compare/v0.25.0...v0.26.0) (2026-05-02)


### Features

* **sf-lsp:** reimagine LSP TUI with in-card panel, HUD, footer, transcript, and rich /sf-lsp panel ([44fde0d](https://github.com/salesforce/sf-pi/commit/44fde0dbc44ba4df48f7effe38032915354372d9))

## [0.25.0](https://github.com/salesforce/sf-pi/compare/v0.24.0...v0.25.0) (2026-05-02)


### Features

* **devbar,gateway:** 1% context bar, decimal % label, 60s cost refresh ([6cb23fe](https://github.com/salesforce/sf-pi/commit/6cb23fecfe20c175ca915eb1a27560efb9b1285f))

## [0.24.0](https://github.com/salesforce/sf-pi/compare/v0.23.1...v0.24.0) (2026-05-02)


### ⚠ BREAKING CHANGES

* peerDependencies `@mariozechner/pi-coding-agent` floor raised to `>=0.72.0`. Users on pi < 0.72 will see extensions skip with a one-line warning pointing to `pi update`.

### Features

* adopt pi 0.72 thinkingLevelMap + per-model baseUrl; expose Opus 4.7 xhigh ([fce2827](https://github.com/salesforce/sf-pi/commit/fce2827deffc80cc20895eb489956faf38c0d387))

## [0.23.1](https://github.com/salesforce/sf-pi/compare/v0.23.0...v0.23.1) (2026-05-01)


### Bug Fixes

* **ci:** correct CODEOWNERS handle to @Jaganpro ([#12](https://github.com/salesforce/sf-pi/issues/12)) ([75c151a](https://github.com/salesforce/sf-pi/commit/75c151a04702d0469dfafe9f86473e2db89e9908))

## [0.23.0](https://github.com/salesforce/sf-pi/compare/v0.22.0...v0.23.0) (2026-05-01)


### Features

* **sf-welcome:** drop Tips panel, show every recommended item ([cbb0d97](https://github.com/salesforce/sf-pi/commit/cbb0d974559b1267f70a4dc70d79add267a6ed72))

## [0.22.0](https://github.com/salesforce/sf-pi/compare/v0.21.1...v0.22.0) (2026-05-01)


### Features

* **sf-welcome:** replace Salesforce AI block with Recommended extensions ([7159edd](https://github.com/salesforce/sf-pi/commit/7159edd5922567e426eaad3f37ae3918de62f64e))

## [0.21.1](https://github.com/salesforce/sf-pi/compare/v0.21.0...v0.21.1) (2026-05-01)


### Bug Fixes

* **sf-llm-gateway-internal:** route Claude through unified dispatcher ([3b00948](https://github.com/salesforce/sf-pi/commit/3b00948597a3c7a29020486746dad1727cb667de))

## [0.21.0](https://github.com/salesforce/sf-pi/compare/v0.20.2...v0.21.0) (2026-05-01)


### Features

* **sf-devbar:** instant thinking-badge repaint on thinking_level_select (pi &gt;= 0.71) ([04a5f36](https://github.com/salesforce/sf-pi/commit/04a5f36b844d5d114eb788e76320159ec46d2b17))
* **sf-llm-gateway-internal:** unify to one /login row with paste-token flow ([2c89661](https://github.com/salesforce/sf-pi/commit/2c896613d6bf2841739df3ae7746a7864480de5a))

## [0.20.2](https://github.com/salesforce/sf-pi/compare/v0.20.1...v0.20.2) (2026-04-30)


### Bug Fixes

* **catalog:** refresh announcements.json for v0.20.1 release ([653e965](https://github.com/salesforce/sf-pi/commit/653e9657846aed0bb422b1ba7a13bbe7353f711b))
* **ci:** dispatch release PR checks even when release-please made no changes ([acb5645](https://github.com/salesforce/sf-pi/commit/acb564525cc6637eed9154d066902c85c9992bca))
* **ci:** grant checks:read so auto-merge can poll gitleaks status ([1a8dfcc](https://github.com/salesforce/sf-pi/commit/1a8dfcc4e8d80f038be9d6e2a919beef1a296e7c))
* **ci:** match release-please PR by branch prefix, not author filter ([2bddbbb](https://github.com/salesforce/sf-pi/commit/2bddbbba714dac5870fa44489b7d7d80633eb74d))
* **ci:** use REST check-runs API to wait for gitleaks on release PR ([d98834e](https://github.com/salesforce/sf-pi/commit/d98834e15391435b57582d612302f885e187106b))
* **security:** bump @anthropic-ai/sdk to 0.91.1 via override (GHSA-p7fg-763f-g4gf) ([e3ed58e](https://github.com/salesforce/sf-pi/commit/e3ed58ebf1a686a13c86501add986bab79f4ca08))

## [0.20.1](https://github.com/salesforce/sf-pi/compare/v0.20.0...v0.20.1) (2026-04-29)


### Bug Fixes

* **catalog:** refresh announcements.json for v0.20.0 release ([#80](https://github.com/salesforce/sf-pi/issues/80)) ([cc910f9](https://github.com/salesforce/sf-pi/commit/cc910f909375c1f438bdce3f7ffb66bc4bccd828))

## [0.20.0](https://github.com/salesforce/sf-pi/compare/v0.19.0...v0.20.0) (2026-04-29)


### Features

* **sf-brain:** reference source-deploy-retrieve metadata registry in Rule 1 ([#78](https://github.com/salesforce/sf-pi/issues/78)) ([9ba6cb8](https://github.com/salesforce/sf-pi/commit/9ba6cb8cd6ebc3282ee0b1c016c86bec439e0b11))

## [0.19.0](https://github.com/salesforce/sf-pi/compare/v0.18.0...v0.19.0) (2026-04-29)


### Features

* **sf-brain:** add high-density Salesforce operator kernel extension ([#74](https://github.com/salesforce/sf-pi/issues/74)) ([aefd65a](https://github.com/salesforce/sf-pi/commit/aefd65a868cedd403de634f35a94f9531df48895))


### Bug Fixes

* **catalog:** refresh srcLoc line counts after sf-brain merge ([#76](https://github.com/salesforce/sf-pi/issues/76)) ([1645c65](https://github.com/salesforce/sf-pi/commit/1645c652e24727c46bc92f3198ea15dcd4297018))

## [0.18.0](https://github.com/salesforce/sf-pi/compare/v0.17.0...v0.18.0) (2026-04-29)


### ⚠ BREAKING CHANGES

* sf-plan extension removed. The /plan and /plan-allow slash commands are no longer available. The sf-devbar plan-mode badge and orange accent have been removed.

### Features

* remove sf-plan extension ([#72](https://github.com/salesforce/sf-pi/issues/72)) ([ebfb009](https://github.com/salesforce/sf-pi/commit/ebfb0098df1131172da360e0a617a1c389b1f3dc))


### Bug Fixes

* **monthly-usage:** share store state via globalThis across jiti instances ([#71](https://github.com/salesforce/sf-pi/issues/71)) ([2aa7e40](https://github.com/salesforce/sf-pi/commit/2aa7e4085d020a9119068c3e00e590ae5a74c9b2))

## [0.17.0](https://github.com/salesforce/sf-pi/compare/v0.16.0...v0.17.0) (2026-04-29)


### Features

* **sf-welcome:** add lifetime usage line and fix monthly-usage sync ([#68](https://github.com/salesforce/sf-pi/issues/68)) ([a8a23ec](https://github.com/salesforce/sf-pi/commit/a8a23ec82bcfef298bbb40283d64f09699695b93))

## [0.16.0](https://github.com/salesforce/sf-pi/compare/v0.15.1...v0.16.0) (2026-04-29)


### Features

* **sf-pi-manager:** recommended external extensions ([#63](https://github.com/salesforce/sf-pi/issues/63)) ([e7513fd](https://github.com/salesforce/sf-pi/commit/e7513fdd57a1ca3ad62ea85a4afdf6e7181443dd))

## [0.15.1](https://github.com/salesforce/sf-pi/compare/v0.15.0...v0.15.1) (2026-04-29)


### Bug Fixes

* **sf-slack:** grid-safe user resolution via assistant.search.context fallback ([a243a24](https://github.com/salesforce/sf-pi/commit/a243a2425844d8139e6c4f69619d6ee389e64895))
* **sf-slack:** warm channel cache from search hits; raw-ID escape hatch in recipient dialog ([6578b69](https://github.com/salesforce/sf-pi/commit/6578b691277db6db3e8f1ce691fbc4fdb79a000e))

## [0.15.0](https://github.com/salesforce/sf-pi/compare/v0.14.1...v0.15.0) (2026-04-29)


### Features

* **sf-slack:** human-in-the-loop recipient resolution as a shared primitive ([#59](https://github.com/salesforce/sf-pi/issues/59)) ([e045ba3](https://github.com/salesforce/sf-pi/commit/e045ba30db0e0e75236b75c4d0da7d2b1984b60c))

## [0.14.1](https://github.com/salesforce/sf-pi/compare/v0.14.0...v0.14.1) (2026-04-29)


### Bug Fixes

* **sf-slack:** action-aware send preflight, canvas error decoding, raw-ID label ([#57](https://github.com/salesforce/sf-pi/issues/57)) ([62cc8b9](https://github.com/salesforce/sf-pi/commit/62cc8b98e334a127106f9fedfcaa03cd012579fd))

## [0.14.0](https://github.com/salesforce/sf-pi/compare/v0.13.1...v0.14.0) (2026-04-29)


### Features

* **sf-slack:** robustness hardening + slack_send messaging ([#55](https://github.com/salesforce/sf-pi/issues/55)) ([95aca1a](https://github.com/salesforce/sf-pi/commit/95aca1a4459ae9f3c3e53ce90244b82812c4ad5d))

## [0.13.1](https://github.com/salesforce/sf-pi/compare/v0.13.0...v0.13.1) (2026-04-28)


### Bug Fixes

* **sf-welcome:** guard setWorkingVisible for pi &lt; 0.70.3 ([#51](https://github.com/salesforce/sf-pi/issues/51)) ([#52](https://github.com/salesforce/sf-pi/issues/52)) ([b7c8ed9](https://github.com/salesforce/sf-pi/commit/b7c8ed9ab505a6496af583db04321896358c67d3))

## [0.13.0](https://github.com/salesforce/sf-pi/compare/v0.12.0...v0.13.0) (2026-04-28)


### Features

* **sf-welcome:** bundled Nerd Font installer + top-left splash anchor ([#49](https://github.com/salesforce/sf-pi/issues/49)) ([759b436](https://github.com/salesforce/sf-pi/commit/759b43612949c43a3c88ba2fcfa3054d86d61cb7))

## [0.12.0](https://github.com/salesforce/sf-pi/compare/v0.11.2...v0.12.0) (2026-04-28)


### Features

* **sf-llm-gateway-internal:** surface retry state + guidance footer ([#39](https://github.com/salesforce/sf-pi/issues/39)) ([#48](https://github.com/salesforce/sf-pi/issues/48)) ([c63fec2](https://github.com/salesforce/sf-pi/commit/c63fec2d53c923fcb85313c5d7e3993d22867e48))


### Bug Fixes

* **sf-llm-gateway-internal:** reduce Opus 4.7 api_error 500s ([#39](https://github.com/salesforce/sf-pi/issues/39)) ([#46](https://github.com/salesforce/sf-pi/issues/46)) ([855e350](https://github.com/salesforce/sf-pi/commit/855e3503c8cf462e1aef960f52a0fc8ef8493097))

## [0.11.2](https://github.com/salesforce/sf-pi/compare/v0.11.1...v0.11.2) (2026-04-27)


### Bug Fixes

* **sf-llm-gateway-internal:** handle Anthropic stream errors ([bedec35](https://github.com/salesforce/sf-pi/commit/bedec3511cc357bad2047390023dc10cd03a6d15))
## [0.11.1](https://github.com/salesforce/sf-pi/compare/v0.11.0...v0.11.1) (2026-04-27)


### Bug Fixes

* **build:** make prepare script tolerant of missing husky binary ([#38](https://github.com/salesforce/sf-pi/issues/38)) ([c6945e1](https://github.com/salesforce/sf-pi/commit/c6945e1caf22ea42857d7ec0c544f644e5d233c1))

## [0.11.0](https://github.com/salesforce/sf-pi/compare/v0.10.5...v0.11.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* **sf-plan:** /plan now defaults to running the planner in an isolated subprocess (child pi process) instead of inline plan mode. The main session no longer sees planner exploration tokens. Restore old behavior via /plan --inline, --plan-inline on startup, or defaultMode: "inline" in ~/.pi/agent/sf-plan.json or <repo>/.sf-pi/plan.json.

### Features

* **sf-llm-gateway-internal:** default OpenAI-family requests to priority service tier ([#35](https://github.com/salesforce/sf-pi/issues/35)) ([c97ec41](https://github.com/salesforce/sf-pi/commit/c97ec41f1353aaa145f26b9b630535f7b2272736))
* **sf-plan:** subprocess-first default, Goals gate, rejection queue, friendly filenames ([#37](https://github.com/salesforce/sf-pi/issues/37)) ([36fbe5c](https://github.com/salesforce/sf-pi/commit/36fbe5cd83d4b3fa1756ef1383d9fd579163e304))

## [0.10.5](https://github.com/salesforce/sf-pi/compare/v0.10.4...v0.10.5) (2026-04-26)


### Bug Fixes

* **sf-llm-gateway-internal:** map pi thinking level to Opus 4.7 effort, default max_tokens to 64K ([90721ff](https://github.com/salesforce/sf-pi/commit/90721ff18083f2e6aa7ec5b2123c345cee799f58))

## [0.10.4](https://github.com/salesforce/sf-pi/compare/v0.10.3...v0.10.4) (2026-04-26)


### Bug Fixes

* **sf-llm-gateway-internal:** seed bootstrap with an OpenAI-compat model ([dfa80e2](https://github.com/salesforce/sf-pi/commit/dfa80e275d35a4dfabda566473794fdeb75f2c57))

## [0.10.3](https://github.com/salesforce/sf-pi/compare/v0.10.2...v0.10.3) (2026-04-26)


### Bug Fixes

* **sf-devbar:** show rainbow gateway badge for Anthropic-native provider ([7d28fd8](https://github.com/salesforce/sf-pi/commit/7d28fd8a0d233f3709a5a3b3a130692a9f9b195b))
* **sf-llm-gateway-internal:** scope enabledModels to both gateway providers ([a37b2b4](https://github.com/salesforce/sf-pi/commit/a37b2b4c85ebb7d946c09f6ccb558b82861194da))

## [0.10.2](https://github.com/salesforce/sf-pi/compare/v0.10.1...v0.10.2) (2026-04-26)


### Bug Fixes

* **sf-llm-gateway-internal:** route Claude natively + max Opus 4.7 thinking ([#28](https://github.com/salesforce/sf-pi/issues/28)) ([97ce346](https://github.com/salesforce/sf-pi/commit/97ce346cbf7b26c96ded17e354de29dded445f07))

## [0.10.1](https://github.com/salesforce/sf-pi/compare/v0.10.0...v0.10.1) (2026-04-25)


### Bug Fixes

* **sf-llm-gateway-internal:** route chat through v1 endpoint ([5a58531](https://github.com/salesforce/sf-pi/commit/5a585314ff0dee543815d3ed2f8b0a182ee00546))

## [0.10.0](https://github.com/salesforce/sf-pi/compare/v0.9.0...v0.10.0) (2026-04-25)


### Features

* **sf-plan:** Salesforce-aware plan mode + devbar integration + optional subagent handoff ([#25](https://github.com/salesforce/sf-pi/issues/25)) ([5a4b411](https://github.com/salesforce/sf-pi/commit/5a4b41143896ad2ea9081ca5f9b42b348bca9bbd))

## [Unreleased]

### ⚠ BREAKING CHANGES

* **sf-plan:** `/plan` now defaults to running the planner in an
  **isolated subprocess** (child `pi` process with its own context
  window) instead of the legacy inline mode. The main session no longer
  sees the planner's exploration tokens. To restore the old behavior,
  use `/plan --inline` or set `defaultMode: "inline"` in
  `~/.pi/agent/sf-plan.json` or `<repo>/.sf-pi/plan.json`. A new
  `--plan-inline` CLI flag also forces inline mode on startup.

### Bug Fixes

* **build:** make the `prepare` script tolerant of a missing `husky`
  binary (`husky || true`). Previously, consumers installing with
  `npm install --omit=dev` (e.g. `pi update`) failed with
  `sh: husky: command not found` and npm exit code 127, because husky
  is a devDependency but the `prepare` lifecycle still runs. Contributor
  workflows are unaffected — a normal `npm install` still installs husky
  and wires up the git hooks.
* **sf-llm-gateway-internal:** seed the bootstrap model catalog with an
  OpenAI-compat model (`gpt-5`) alongside the Claude defaults. The
  bootstrap is registered synchronously before Pi resolves `enabledModels`
  at startup; previously it contained only Claude models, leaving the
  OpenAI-compat provider registered with zero models and triggering
  `Warning: No models match pattern "sf-llm-gateway-internal/*"` on every
  launch until async discovery filled the catalog.

### Features

* **sf-plan:** new extension — Salesforce-aware plan mode (read-only
  exploration, per-session plan file, deterministic SF-CLI-aware
  allowlist, `/plan` action menu with Exit & summarize-branch reusing
  Pi's `/tree` summarization, `/plan-allow [--save]`, `/plan doctor`,
  `--plan` / `--no-plan` CLI flags, and `Ctrl+Alt+P` shortcut).
* **sf-plan:** direct-subprocess planner replaces the optional
  `pi-subagent` handoff. sf-plan spawns a bare `pi` child in JSON mode
  and forwards summary rows into the parent session via a dedicated
  `sf-planner` custom-message renderer. Child runs with
  `--no-session --no-skills --no-context-files` and a narrow
  `--tools` allowlist; raw ndjson is teed to
  `.pi/plans/<runId>.events.ndjson` for debugging.
* **sf-plan:** forcing functions + UX refinements.
  - **Goals gate:** exploration tools (bash/grep/find/ls, and `read`
    against anything other than the plan file) are blocked until the
    agent writes real content to `## Goals`. The only path past the
    gate is a `write` to the plan file.
  - **Empty-plan guard:** the action menu hides "Execute" until the
    plan file has numbered steps under `## Plan`.
  - **Plan preview:** the action menu prompt shows the first 10
    numbered steps so the user knows what they're approving.
  - **Rejection queue:** blocked bash commands are grouped by first
    token and reviewed at the action-menu boundary (no mid-turn UI
    interruptions). The new `Review blocked commands (N unique)`
    entry offers session / repo / user persistence per token.
  - **Per-turn circuit breaker:** three blocks of the same first
    token in one turn return a sharpened block reason telling the
    LLM to stop retrying and summarize intent.
  - **Friendly plan filenames:** `<date>-<slug>-<shortId>.plan.md`
    (e.g. `2026-04-26-improve-forcing-functions-019dca52.plan.md`)
    replaces the raw UUID filename. Slug is derived from the first
    user message or `/plan <task text>` argument.
  - **cd allowlist:** `cd` is now allowed as a shell-state read.
    Chained writes (`cd foo && rm ...`) still hit the blocklist on
    the write segment.
* **sf-devbar:** integrate with sf-plan — surface the `sf-plan` status key in
  the bottom bar and swap the gateway-label accent color to orange while plan
  mode is active.

## [0.9.0](https://github.com/salesforce/sf-pi/compare/v0.8.0...v0.9.0) (2026-04-25)


### Features

* **sf-slack:** gate tool registration on auth and tighten prompt surface ([beb3ade](https://github.com/salesforce/sf-pi/commit/beb3ade6006c1b5de90b067626df62442ac3db21))


### Bug Fixes

* **sf-llm-gateway-internal:** arm choice normalizer per request ([ea52835](https://github.com/salesforce/sf-pi/commit/ea528357c3fe46367c5ee3187877a4360b53fcda))

## [0.8.0](https://github.com/salesforce/sf-pi/compare/v0.7.0...v0.8.0) (2026-04-25)


### Features

* **sf-slack:** add deterministic time range tool ([cae07d8](https://github.com/salesforce/sf-pi/commit/cae07d84ebae099de649e1734ae0402899a8296c))


### Bug Fixes

* **sf-llm-gateway-internal:** normalize streamed choice indexes ([fe8eab9](https://github.com/salesforce/sf-pi/commit/fe8eab9820ac24d1e3635bb09c55f2509194e8f5))

## [0.7.0](https://github.com/salesforce/sf-pi/compare/v0.6.0...v0.7.0) (2026-04-25)


### Features

* **sf-slack:** add resolver and research tools ([0cf820e](https://github.com/salesforce/sf-pi/commit/0cf820ef10f4273e879e321fb0c6497e87887945))
* **sf-slack:** render full thread/history bodies by default ([d440b3c](https://github.com/salesforce/sf-pi/commit/d440b3ce181240e4d799ea2b0982cdef351f85e1))


### Bug Fixes

* **sf-slack:** clarify unresolved channel research ([204a8f9](https://github.com/salesforce/sf-pi/commit/204a8f93c689aee7317b67e82729320f5dfafa3c))

## [0.6.0](https://github.com/salesforce/sf-pi/compare/v0.5.2...v0.6.0) (2026-04-24)


### Features

* add shared display profiles ([c93c92d](https://github.com/salesforce/sf-pi/commit/c93c92d0075e9dc93c062d8dedf7d568e5dc44af))
* **sf-slack:** render reactions as unicode glyphs with semantic fallback ([5460dc0](https://github.com/salesforce/sf-pi/commit/5460dc05b57d970c36fd6197c6b68d38f3a1221b))

## [0.5.2](https://github.com/salesforce/sf-pi/compare/v0.5.1...v0.5.2) (2026-04-24)


### Bug Fixes

* support Pi 0.70.2 compatibility ([2c891fe](https://github.com/salesforce/sf-pi/commit/2c891fe47656d935fb4c868cfa0788ed699530b0))

## [0.5.1](https://github.com/salesforce/sf-pi/compare/v0.5.0...v0.5.1) (2026-04-23)


### Bug Fixes

* **sf-welcome:** terminal-compatible splash layout and glyph policy ([#18](https://github.com/salesforce/sf-pi/issues/18)) ([4db89d7](https://github.com/salesforce/sf-pi/commit/4db89d70272b1548f3a291a518ef6ba839d20d4a)), closes [#17](https://github.com/salesforce/sf-pi/issues/17)

## [0.5.0](https://github.com/salesforce/sf-pi/compare/v0.4.0...v0.5.0) (2026-04-23)


### Features

* **sf-agentscript-assist:** in-process Agent Script authoring companion ([#15](https://github.com/salesforce/sf-pi/issues/15)) ([4b4cc5c](https://github.com/salesforce/sf-pi/commit/4b4cc5c02011cf8a047f491791991fb3e0f638a9))
* **sf-llm-gateway-internal:** opt-in raw fetch wire trace ([#16](https://github.com/salesforce/sf-pi/issues/16)) ([90e109c](https://github.com/salesforce/sf-pi/commit/90e109c4a3c89a27376a83959d7ac9325c568fcb))


### Security

* **deps:** override uuid to &gt;=14.0.0 to clear GHSA-w5hq-g745-h8pq ([#13](https://github.com/salesforce/sf-pi/issues/13)) ([e75316a](https://github.com/salesforce/sf-pi/commit/e75316a73953f11284e00648f1c62c7612e695d2))

## [0.4.0](https://github.com/salesforce/sf-pi/compare/v0.3.0...v0.4.0) (2026-04-22)


### Features

* **sf-slack:** redesign TUI thread/history/search rendering ([#11](https://github.com/salesforce/sf-pi/issues/11)) ([f47d0c6](https://github.com/salesforce/sf-pi/commit/f47d0c6d1a8433ab3edf586d91275dc2d7bfbd8f))

## [0.3.0](https://github.com/salesforce/sf-pi/compare/v0.2.0...v0.3.0) (2026-04-22)


### Features

* **sf-slack:** always resolve authors and &lt;@UID&gt; mentions via users.info ([#10](https://github.com/salesforce/sf-pi/issues/10)) ([bb6fbad](https://github.com/salesforce/sf-pi/commit/bb6fbadd91e061d2fb001a9b81d15146a9b08664))
* **sf-slack:** conversation-ladder rendering + name resolution + rate-limit hardening ([#8](https://github.com/salesforce/sf-pi/issues/8)) ([959f42a](https://github.com/salesforce/sf-pi/commit/959f42a0fe04d7b5dc351b80ac0e0649cb8ffe03))

## [0.2.0](https://github.com/salesforce/sf-pi/compare/v0.1.1...v0.2.0) (2026-04-22)


### Features

* **sf-slack:** context-efficient tool output (P1-P6) ([03a3622](https://github.com/salesforce/sf-pi/commit/03a3622471f106d5436c4856b79aec8219c30982))
* **sf-slack:** context-efficient tool output (P1-P6) ([37988dc](https://github.com/salesforce/sf-pi/commit/37988dc672361048a84ea2081e0cc0203013c87a))


### Bug Fixes

* **deps:** migrate to typebox 1.x for pi 0.69.0 compatibility ([384d681](https://github.com/salesforce/sf-pi/commit/384d681729836b0c3f9b5095ab691a5ec0b8b0ce))

## [0.1.1](https://github.com/salesforce/sf-pi/compare/v0.1.0...v0.1.1) (2026-04-22)


### Bug Fixes

* **ci:** handle Pi peer-dep wildcards and private-repo CodeQL ([2839504](https://github.com/salesforce/sf-pi/commit/2839504117f222b7e77ea5de5c630cc5650517cc))
* **ci:** plumb GITHUB_TOKEN into gitleaks for PR scans ([c5a5a17](https://github.com/salesforce/sf-pi/commit/c5a5a178e4fe7bc82b9f13da4b912ef602545dbd))
* **ci:** unblock PR checks for gitleaks, release-please, and prettier ([21bf0ab](https://github.com/salesforce/sf-pi/commit/21bf0ab6232323edf37b129b03de5b695a8a10a9))

## [Unreleased]

### Changed

- **sf-slack TUI rendering overhaul.** Channel IDs like `C01ABC123` now
  resolve to `#agentscript-dev` (channel cache pre-warmed on `session_start`).
  Raw `ts:1776790851.230879` strings in call headers are replaced with
  friendly `Tue · 5:00 PM (1d ago)` labels. Each author gets a stable
  initial badge in a color hashed from their display name. Thread view is
  now a true conversation ladder (`●` parent, `│ ↳` replies) in both
  collapsed and expanded modes, with reaction chips, reply-count badges,
  OSC 8 per-message permalinks, and proper `> quote` / ` ``` ` code-fence
  rendering via markdown theme tokens. Collapsed preview widens to 110
  chars. All colors flow through `theme.fg(ThemeColor, ...)` — no hardcoded
  hex. Snapshots pinned to `TZ=UTC` for deterministic CI.

## [0.1.0] - 2026-04-22

### Added

- Initial public release as `sf-pi`.
- Core extension manager (`sf-pi-manager`) with TUI overlay, `/sf-pi`
  subcommands, and native pi package-filter integration.
- Real-time Salesforce LSP diagnostics via `sf-lsp`.
- Slack integration via `sf-slack` (search, threads, channels, users, files, canvases).
- Salesforce LLM Gateway provider (`sf-llm-gateway-internal`, internal-only).
- `sf-devbar`, `sf-welcome`, `sf-ohana-spinner`, `sf-skills-hud` UI extensions.
- Generated catalog (`catalog/index.json`, `catalog/registry.ts`) derived from
  per-extension `manifest.json`.
- Apache-2.0 license, non-affiliation `NOTICE.md`, Contributor Covenant CoC,
  `SECURITY.md`, issue and PR templates.

### Security

- No hardcoded gateway endpoints or credentials in source.
- Repo sanitized via `gitleaks` prior to first public push.

---

[Unreleased]: https://github.com/salesforce/sf-pi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/salesforce/sf-pi/releases/tag/v0.1.0

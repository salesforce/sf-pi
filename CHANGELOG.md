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

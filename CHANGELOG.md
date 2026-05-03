# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Breaking Changes

- **Raised pi-coding-agent peerDependency floor to `>=0.72.0`.** sf-pi now
  depends on pi 0.72+ APIs (model-level `thinkingLevelMap` and per-model
  `baseUrl` overrides on `pi.registerProvider()`), so running against
  older pi builds will no longer work. To soften the blow for users who
  update sf-pi before updating pi, every extension factory now calls a new
  `requirePiVersion()` gate in `lib/common/pi-compat.ts` at the top of the
  factory. On pi < 0.72 the gate logs a single actionable warning per
  extension ("requires pi-coding-agent >= 0.72.0, found <x>. Run
  `pi update`\...") and short-circuits, so the rest of pi keeps starting
  instead of crashing with `schema validation failed` or
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
- **Drop pi 0.70-era compatibility casts.** Now that the floor is 0.72,
  the `ProviderConfigWithName` structural cast in
  `sf-llm-gateway-internal/lib/discovery.ts` and the `pi.on as unknown
  as ...` cast around `thinking_level_select` in `sf-devbar/index.ts` are
  gone; both use the real `ProviderConfig` / event typings from
  `@mariozechner/pi-coding-agent`.

### Notes

- Pi 0.72 also introduces `shouldStopAfterTurn` (post-turn stop callback
  inherited from `@mariozechner/pi-agent-core`). No sf-pi extension needs
  it today; it is available to any future extension that wants to exit
  the agent loop gracefully after a completed turn.

### Features

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
  existing saved-config users are not affected. peerDependencies floor
  stays at pi 0.70.3.

- **sf-devbar: instant thinking-badge repaint on `thinking_level_select`
  (pi ≥ 0.71).** pi 0.71 emits `thinking_level_select` whenever the user
  flips thinking level via shortcut, settings, or model clamp. Previously
  the devbar only refreshed the rainbow badge on the next turn boundary,
  leaving it visibly stale while idle. Backward-compatible: pi 0.70.x
  never emits the event, and pi's extension loader stores unknown-event
  handlers as a no-op.

### Bug Fixes

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

- **pi 0.71 compatibility.** pi 0.71 removed built-in Google Gemini CLI
  and Antigravity providers. sf-pi does not use either, so upgrading pi
  is safe. Added a `PI_CODING_AGENT_SESSION_DIR` pointer in the README
  for users who want to relocate session storage (pi ≥ 0.71 only).

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
  action=channel to=C09MFCX4A2H ...`) the synchronous channel-name
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

- **sf-slack TUI rendering overhaul.** Channel IDs like `C0958CRG806` now
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

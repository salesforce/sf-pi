# Pi 0.81 Runtime Adoption Plan

Status: Pi 0.81.1 runtime adoption implemented with credential containment; native interactive login remains deferred

## Goal

Adopt Pi 0.80.7–0.81 capabilities only where they make SF Pi simpler, safer, or more agentic. Delegate generic runtime mechanics to proven Pi interfaces, preserve Salesforce-specific workflow value, and delete each superseded path only after observable behavior parity.

## Decision sources

- `docs/adr/0078-pi-native-credential-ownership.md`
- `docs/adr/0079-audited-pi-runtime-support-window.md`
- `docs/adr/0080-active-branch-latest-context-projection.md`
- `docs/adr/0081-complete-native-gateway-provider.md`
- `docs/adr/0082-sf-skills-native-parity-before-delegation.md`
- `docs/adr/0083-sf-browser-progressive-tool-activation-pilot.md`
- `docs/adr/0084-agent-settled-update-coordinator.md`
- `docs/adr/0085-agent-workflow-visibility-contract.md`
- `docs/adr/0086-behavior-proof-ladder.md`
- `docs/adr/0087-secure-native-credential-prompt-prerequisite.md`

## Baseline evidence

- The original repository development dependencies were Pi 0.80.6 with an open-ended `>=0.80.6` compatibility claim.
- Exact-package checks originally passed on Pi 0.80.7 and failed on 0.80.8–0.81.0 at seven `ModelRegistry.authStorage` calls in SF Docs and SF Slack.
- The implemented runtime window is `>=0.81.1 <0.82.0` with exact Pi 0.81.1 development dependencies and no production `.authStorage` access.
- Published Pi 0.81.0 and 0.81.1 declare secret auth prompts but their TUI uses an ordinary input and echoes submitted values.
- Current validation is green on the locked runtime: 457 test files and 3,407 tests pass.
- SF Pi declares 41 LLM tools; Browser, Data 360, and Slack own 31.

## Non-goals

- No implementation before separate authorization.
- No private Pi imports, direct `auth.json` writes, or duplicate secret store.
- No old/new production Provider paths after parity.
- No package-wide capability router in the first dynamic-tool slice.
- No replacement of the purpose-built SF DevBar.
- No wholesale SF Skills deletion before real resolver parity.
- No copying direct-provider model metadata into the Gateway without Gateway evidence.

## Work classifications

Not every item below is a deletion milestone.

- **Prerequisite gate** — external behavior that must exist before SF Pi can proceed.
- **Containment slice** — a separately authorized safety/support correction while blocked.
- **Deletion-Gated Adoption Milestone** — one production behavior change, its red proof, replacement, deletion, and green proof.
- **Evidence gate** — read-only comparison that authorizes no production deletion.
- **Pilot** — reversible production experiment with explicit keep/stop/expand outcome.
- **Release gate** — aggregate evidence after every originating slice is already green.

## Mandatory gate for every production deletion

Before advancing past any production deletion milestone:

1. Pure behavior tests cover the changed contract and edge cases.
2. A real-seam integration runs against the exact supported Pi package; hand-shaped mocks are supplementary only.
3. Typecheck and relevant tests pass at both **Pi Runtime Support Window** edges:
   - exact inclusive floor;
   - newest available in-window release.
4. Focused tests and the full local suite pass.
5. A sanitized artifact proves the changed path executed when fixtures are insufficient.
6. Narrow and wide TUI QA passes when visible rendering changed.
7. Generated catalogs/docs are updated and checked in the same originating slice when manifests or surfaces changed.
8. Any failure stops the milestone; the next milestone does not begin.

Expected aggregate commands after Milestone 1 adds support-window scripts:

```bash
npm run test:pi-floor
npm run test:pi-window-latest
npm run format:check
npm run check
npm test
npm run validate:ci
```

Live artifacts must be sanitized before persistence, not only during final release review.

## Milestone map

| ID  | Classification        | Outcome                                                                 | Depends on                              |
| --- | --------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| P0  | deferred prerequisite | Pi ships masked, non-echoed native secret input for interactive login   | none                                    |
| C0  | completed containment | Compatibility/auth claims fail safely while credential entry is blocked | none                                    |
| M1  | deletion milestone    | Pi 0.81.1 runtime window with contained Docs/Slack auth                 | C0                                      |
| M2A | deletion milestone    | Active-branch latest context                                            | M1                                      |
| M2B | deletion milestone    | Display-only output is model-invisible                                  | M1                                      |
| M2C | correction milestone  | DevBar consumes nullable public Pi facts correctly                      | M1                                      |
| M2D | deletion milestone    | Gateway `max` is capability-only                                        | M1                                      |
| M2E | deletion milestone    | Herdr uses real Pi event shapes                                         | M1                                      |
| M2F | correction milestone  | Catalog attests actual Code Analyzer hooks                              | M1                                      |
| M3A | deletion milestone    | Complete native Gateway Provider                                        | M1, M2A, M2D                            |
| M3B | deletion milestone    | Legacy project-token execution fallback ends                            | one released migration window after M3A |
| E4  | evidence gate         | SF Skills Pi-vs-Funnel parity matrix                                    | M1                                      |
| P5  | reversible pilot      | SF Browser progressive tool activation decision                         | M2A                                     |
| M6  | deletion milestone    | Agent-Settled Update Coordinator                                        | M1, M2B                                 |
| R7  | release gate          | Final evidence, docs, and sanitization                                  | all accepted outcomes                   |

---

## P0 — Future secure native credential prompt

### Objective

Land and release a Pi 0.81 patch whose interactive auth UI masks secret input and never echoes the submitted value.

### Upstream targets

Likely Pi files:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/login-dialog.ts`
- matching interactive auth/TUI tests

### Red behavior proof

Drive `AuthInteraction.prompt({ type: "secret" })` through the real interactive adapter and assert:

- typed characters are absent from rendered lines;
- submitted secret text remains absent after confirmation;
- text/manual-code prompts retain visible behavior;
- cancel and retry behavior remain correct.

### Current disposition

SF Pi does not patch or fork the Pi runtime. This prerequisite is deferred until an official Pi release provides the secure behavior. It blocks only interactive native `/login` delegation; it does not block the contained Pi 0.81.1 runtime window.

### Exit gate

An official Pi release passes this proof. That release can enable the later native-login deletion slice.

### Hard stops

- Masked editing with post-submit echo does not pass.
- Type declarations alone do not pass.
- SF Pi does not add a local credential writer or private-storage adapter.

---

## C0 — Completed transitional containment

Implementation status: completed as the bridge that removed unsafe mutation before the Pi 0.81.1 runtime adoption. Its temporary 0.80 window is superseded by M1.

### Outcomes

- Tell any user who entered a token through an affected visible input to rotate it; rotation is an explicit operational action and is never automated.
- Set the temporary coding-agent peer range to `>=0.80.6 <0.80.8`.
- Pin the Pi development packages to exact, mutually matching `0.80.7` versions instead of caret ranges; verify 0.80.6 as the temporary floor separately.
- Add an exclusive `0.80.8` runtime ceiling with an actionable unsupported-version message.
- Suspend automatic/latest Pi updates while containment is active; keep independent Salesforce CLI updates and route Pi version guidance through `/sf-pi doctor runtime`.
- Disable ordinary plaintext token-entry fields in SF Docs and SF Slack; do not present them as secure.
- Keep existing stored credentials and environment-variable execution (`SF_DOCS_MCP_TOKEN`, `SLACK_USER_TOKEN`) working.
- Explain the secure upstream prerequisite without exposing credential values.

### Likely files

- `package.json`
- `package-lock.json`
- `lib/common/pi-compat.ts`
- `lib/common/tests/pi-compat.test.ts`
- SF Docs/Slack Connect panels and status/help tests
- SF Pi Manager auto-update and doctor surfaces/tests
- SF Welcome release-status surfaces/tests

### Gate

Prove below-floor rejection, 0.80.6/0.80.7 acceptance, 0.80.8 rejection, focused auth/status behavior, full suite, and narrow/wide TUI behavior with token-shaped values absent from renders, errors, and snapshots.

Implementation evidence:

- exact Pi 0.80.7 development packages and `>=0.80.6 <0.80.8` peer range;
- runtime floor/ceiling tests and 0.80.6/0.80.7 nightly matrix;
- automatic Pi update suppression plus bounded Doctor/Welcome guidance;
- SF Docs/Slack behavior tests for non-input panels, blocked provider login, source-only status, existing-credential logout handoff, and environment guidance;
- static policy test covering production `.authStorage` access;
- Pi 0.80.6 floor and Pi 0.80.7 ceiling overlays each passed typecheck plus 459 test files (3,421 passed tests and 6 skipped tests);
- `npm run validate:ci`, generated-catalog checks, docs health/build, ESLint, formatting, SPDX, panel/boot/lifecycle checks, and the public artifact scan passed.

---

## M1 — Audited Pi 0.81.1 runtime with contained Docs/Slack auth

### Objective

Adopt Pi 0.81.1, enforce the support window, remove extension-side credential mutation, and retain blocked interactive entry until P0 is available.

### Likely files

Runtime and CI:

- `package.json`
- `package-lock.json`
- `lib/common/pi-compat.ts`
- `lib/common/tests/pi-compat.test.ts`
- new support-window scripts/tests
- `.github/workflows/ci.yml`
- `.github/workflows/nightly.yml`
- runtime-floor docs and changelog

SF Docs/Slack:

- `extensions/sf-docs/index.ts`, `lib/auth.ts`, `lib/types.ts`
- `extensions/sf-docs/lib/manager-action-panels.ts`
- new `extensions/sf-docs/tests/native-auth.test.ts`
- `extensions/sf-slack/index.ts`, `lib/auth.ts`
- `extensions/sf-slack/lib/manager-action-panels.ts`
- new `extensions/sf-slack/tests/native-auth.test.ts`
- existing smoke/auth/status/scope tests
- `lib/common/pi-auth-status.ts` and tests

### Red behavior proofs — runtime window

Package metadata and runtime gate must agree on all cases:

- below-floor version is rejected;
- exact floor is accepted;
- newest `0.81.x` is accepted;
- `0.82.0` is rejected;
- unsupported `0.82.0-*` prereleases are rejected;
- malformed/unknown host version follows one documented fail-safe policy;
- required CI fails if either edge disagrees with package metadata.

The implemented range is:

```text
>=0.81.1 <0.82.0
```

### Deferred behavior proofs — native interactive auth

These proofs remain deferred until P0. The current runtime slice rejects interactive entry before any secret prompt.

- SF Docs registers a complete Pi provider with native API-key authentication and requests its MCP token through `AuthInteraction.prompt({ type: "secret" })`.
- `/login sf-docs` uses the secure native prompt and provider auth resolves the saved token.
- Connect visibly prefills or hands off to `/login sf-docs`; Disconnect visibly hands off to `/logout`.
- `/logout` removes only the stored credential; `SF_DOCS_MCP_TOKEN` and `SLACK_USER_TOKEN` remain untouched.
- Re-auth replaces the credential; cancellation/failure preserves the previous value.
- Slack proves supported native API-key and configured OAuth paths plus post-auth scope gating.
- Existing OAuth-shaped SF Docs credentials remain a read-only migration source until explicit re-authentication; no silent rewrite.
- Status recognizes canonical API-key and OAuth shapes without exposing values.
- Token-shaped values are absent from rendered UI, submitted-state rendering, errors, snapshots, transcript entries, and persisted status artifacts.
- A static policy test fails if `.authStorage` returns to production source.
- Panels contain no secret-saving callback.

### Deletion gate

Delete in this milestone:

- seven `ctx.modelRegistry.authStorage` calls;
- custom secret-saving callbacks and form state;
- fake manual-refresh credential-writing paths; retain read-only compatibility for existing credential shapes and genuine OAuth refresh behavior;
- docs that present panel-owned secret persistence as canonical.

The status-only auth adapter remains bounded to configured/not-configured detection and never returns credential values.

### Required gate

Apply the complete mandatory production-deletion gate, including exact Pi 0.81.1 typecheck/tests, full suite, contained-auth artifacts, and narrow/wide Connect/logout TUI QA.

Implementation evidence:

- exact Pi 0.81.1 development packages and `>=0.81.1 <0.82.0` peer/runtime window;
- production source contains no `.authStorage` access or visible token/callback input;
- existing stored credentials and environment fallbacks remain usable;
- Connect blocks before Pi's unsafe secret prompt and Disconnect visibly hands off to `/logout`;
- Doctor, Welcome, nightly CI, and Auto Update stay inside the audited 0.81 line;
- full validation passes 459 test files and 3,421 tests; production audit is clean.

### Hard stops

- If legacy credentials cannot remain usable without exposing or rewriting them, stop for a migration decision.
- If native logout cannot target the intended credential clearly, retain only a visible handoff; do not emulate deletion.

---

## M2A — Active-branch latest context

### Objective

Make hidden model context branch-correct, compaction-aware, and latest-value for mutable facts.

### Likely files

- `lib/common/session/inject-once.ts`
- shared latest-context projection helper under `lib/common/session/`
- `lib/common/tests/inject-once.test.ts`
- new `lib/common/tests/active-branch-context.test.ts`
- SF Brain, DevBar, Slack, and Guardrail injection call sites/tests

### Red proofs

- An abandoned sibling does not suppress active-branch injection.
- A→B→A leaves A as the latest model-visible mutable value.
- Compaction reinjects immutable guidance only when it is no longer live.
- Resume, fork, and tree navigation reconstruct the same active context.
- Superseded model-visible context is filtered; state, approval, and audit entries remain.

### Deletion gate

Delete all-entry freshness scanning and historical-equality semantics.

### Required gate

Mandatory gate plus a sanitized session-tree artifact showing sibling, compaction, and A→B→A behavior. No visual QA unless rendering changes.

### Hard stop

Any filtering of state-only entries or hard Guardrail enforcement stops the slice.

---

## M2B — Human-only command output

### Objective

Make display-only Gateway and Feedback command reports model-invisible.

### Likely files

- `extensions/sf-llm-gateway-internal/index.ts`
- `extensions/sf-feedback/index.ts`
- related message renderers and mode-behavior tests

### Red proofs

TUI, RPC, print, and JSON/headless reports remain visible through the correct human channel, but no `custom_message` reaches later model context. Only actionable findings may queue an agent-visible follow-up.

### Deletion gate

Delete display-only `sendMessage()` calls and any renderer left with no other purpose.

### Required gate

Mandatory gate and mode-by-mode artifact; TUI QA only if visible output changes.

---

## M2C — DevBar public-runtime fact correction

### Objective

Retain SF DevBar while consuming Pi facts honestly.

### Likely files

- `extensions/sf-devbar/index.ts`
- `extensions/sf-devbar/lib/top-bar.ts`
- DevBar adapter/render tests

### Red proofs

- nullable `ctx.getContextUsage().percent` renders unknown, not `0%`;
- zero and fractional percentages remain correct;
- optional public session name rendering is bounded on narrow terminals;
- no local usage/cache parser is introduced.

### Required gate

Mandatory non-deletion correction gate, including narrow/wide and theme TUI QA.

---

## M2D — Capability-only Gateway `max`

### Objective

Remove implicit thinking-level mutation while preserving proven model capability maps.

### Likely files

- Gateway index/config lifecycle code
- thinking/model tests and docs

### Red proofs

Selecting, restoring, or switching Gateway models performs zero implicit `setThinkingLevel()` calls. Pi/user settings persist. Supported models expose `max`; unsupported models do not.

### Deletion gate

Delete passive defaulting state, lifecycle calls, and test-only accessors.

### Required gate

Mandatory gate at both runtime-window edges plus one live capability query per representative model family where available.

---

## M2E — Real Herdr event shapes

### Objective

Remove the local end-event shape that invents `args` not supplied by Pi.

### Likely files

- `extensions/sf-herdr/lib/signal-state.ts`
- `extensions/sf-herdr/index.ts`
- signal-state tests

### Red proofs

Workflow inference passes using exported Pi event/result shapes for Agent Script, Data 360, Apex, LWC, Browser, and Herdr commands.

### Deletion gate

Delete `HerdrToolExecutionEndEvent` and redundant observation, or capture start args by call ID only if behavior proves the early signal is necessary.

### Required gate

Mandatory gate; no live proof unless upstream Herdr behavior cannot be fixture-proven.

---

## M2F — Catalog event attestation

### Objective

Make generated extension metadata report Code Analyzer's actual `tool_result` and `agent_settled` hooks.

### Likely files

- `extensions/sf-code-analyzer/manifest.json`
- catalog/docs generator or event lint if helper registration remains invisible
- generated catalog/docs
- docs-health tests

### Red proofs

The generator/lint detects delegated helper registrations or accepts an explicit manifest declaration, and generated orientation lists both events.

### Required gate

Generate and validate catalog/docs in this slice; do not defer them to R7.

---

## M3A — Complete Gateway Provider replacement

### Objective

Replace generic Gateway runtime mechanics with one complete Pi Provider while preserving Gateway-specific behavior.

### Likely files

- new `extensions/sf-llm-gateway-internal/lib/provider.ts`
- Gateway discovery/config/models/transport/index/setup/status modules
- provider, auth, catalog, model, transport, compaction, telemetry, and live tests

### Credential precedence and bounded migration

During one released SF Pi minor migration window:

1. native Pi saved credential;
2. environment-variable fallback;
3. legacy project token only when neither source exists.

Rules:

- new project secrets cannot be saved;
- native login can be verified while a legacy token remains because native auth wins;
- status identifies the source and migration deadline without showing the token;
- user may explicitly remove the legacy field only after native verification;
- the legacy execution fallback expires after one released SF Pi minor and is removed in M3B;
- expiration removes only SF Pi's use of the value, never silently deletes the user's file content.

### Red proofs — Provider/auth

- one provider ID and one login row;
- native login and logout;
- precedence above, verification, explicit legacy removal, and deadline behavior;
- environment fallback;
- project config rejects new secrets.

### Red proofs — catalog/refresh

- static baseline without network;
- stored dynamic catalog restores before refresh;
- explicit refresh changes models;
- failed/aborted refresh retains last-known models;
- non-callable sentinels remain filtered;
- `models.json` overrides remain topmost.

### Red proofs — Gateway-specific parity

- all three transport families preserve text, tools, thinking maps, bounded retry, response errors, headers, service tier, and compaction;
- model-group drift still reports correctly;
- doctor diagnostics and Gateway spend remain correct;
- no implicit thinking-level mutation;
- no awaited or hidden startup network call.

### Deletion gate

Delete after all parity passes:

- custom model cache and cached re-registration;
- delayed startup discovery timer;
- repeated legacy registration coordination;
- pseudo-auth marker;
- API-tag stripping and ID dispatcher;
- redundant generic model matching;
- architecture-assertion tests replaced by behavior proofs.

### Required gate

Mandatory gate plus sanitized live artifacts for one route per transport family covering text, tool call, supported thinking, compaction, and bounded retry/failure evidence.

### Hard stops

Any regression in login/logout, offline bootstrap, failure retention, override precedence, drift, diagnostics, spend, retry bounds, or transport parity prevents deletion.

---

## M3B — End legacy project-token execution fallback

### Objective

End the bounded compatibility read path after the announced migration window.

### Red proofs

- a legacy-only project token is no longer used for requests after the cutoff;
- status detects its presence without printing or using it and gives native login/removal guidance;
- native and environment credentials continue to work;
- no file content is silently deleted.

### Deletion gate

Delete legacy token request precedence and execution use. Retain only non-secret detection needed for migration guidance until a later user-authorized cleanup.

### Required gate

Mandatory gate at both runtime-window edges plus sanitized migration artifacts.

---

## E4 — SF Skills Resource Resolution Parity Proof

### Objective

Produce evidence only; change no SF Skills production behavior.

### Likely files

- new `extensions/sf-skills/tests/pi-resource-parity.test.ts`
- isolated test fixtures
- temporary parity report artifact outside source control
- ADR 0082 follow-up only after user review

### Scenarios

- global load + project inherit;
- global load + project unload;
- global off + project load;
- package `autoload:false` delta;
- exact `+path` / `-path`;
- duplicate names across package, `.pi/skills`, and `.agents/skills`;
- trusted vs untrusted project;
- missing/stale roots;
- one-skill and whole-source global→project rescope.

Compare the Funnel result with Pi's real `DefaultPackageManager`/resource loader and classify each capability:

- native parity → deletion candidate;
- Salesforce-specific leverage → retain;
- useful generic gap → upstream candidate;
- semantic disagreement → return for decision.

### Exit gate

A reviewed matrix exists. No production deletion is authorized by this milestone.

---

## P5 — SF Browser Progressive Tool Activation Pilot

### Objective

Measure additive activation without routing or safety fragility.

### Likely files

- `extensions/sf-browser/index.ts`
- new `extensions/sf-browser/lib/progressive-tools.ts`
- Browser registration modules/tests
- Guardrail integration tests
- manifest/docs if active-vs-registered behavior is surfaced

### Initial posture

Initially active:

- `sf_browser_open_org`
- `sf_browser_resolve_path`

Registered but inactive until a visible workflow entry:

- snapshot, click, fill, select, press, editor, wait, evidence

Activation may add only tools from the original Pi-selected eligible baseline.

### Red proofs

- next request can call newly active tools;
- activation is additive;
- unknown/excluded tools never activate;
- user confirmation and Guardrail still mediate committing gestures;
- headless restrictions remain unchanged;
- fallback models work;
- resume/compaction reconstruct a usable set.

### Success metrics

- initial Browser schemas fall from ten to two;
- normal open→snapshot flow gains no synthetic search turn;
- prompt/tool-schema size is recorded before and after;
- cache behavior is recorded when exposed;
- zero safety, exclusion, confirmation, or headless regressions.

### Keep/stop/expand outcomes

- **Keep** only after the complete mandatory production gate and measurable benefit.
- **Stop** on any next-turn, fallback, exclusion, confirmation, Guardrail, headless, resume/compaction, or benefit failure; restore the eager active set and delete the progressive layer.
- **Expand** requires separate authorization; it never follows automatically.
- Provider compatibility flags remain forbidden without live route proof.

---

## M6 — Agent-Settled Update Coordinator

### Objective

Keep Auto Update while replacing the one-shot startup race with a consent-preserving, bounded coordinator.

### Likely files

- `extensions/sf-pi-manager/lib/auto-update-command.ts`
- `extensions/sf-pi-manager/index.ts`
- `lib/common/auto-update/store.ts`
- a focused Human-Only row renderer if justified
- Manager/shared update tests
- manifest and generated docs for actual events
- SF Welcome status rendering as needed

### Red proofs — scheduling and consent

- due work while busy becomes pending;
- next `agent_settled` runs it once;
- opt-in is re-read immediately before the first mutation and before each later target;
- revoked opt-in cancels pending work;
- a new agent turn or loss of idle/settled state aborts or skips remaining work;
- concurrent coordinator/update runs cannot overlap;
- reload/shutdown cancels stale work.

### Red proofs — compatibility and targets

- Pi runtime outside the support window is skipped;
- Pi runtime, Pi packages, and Salesforce CLI targets are classified independently;
- package updates whose compatibility cannot be established are skipped;
- one target failure does not hide later independently safe targets;
- no updater becomes an npm/Homebrew/git installer.

### Red proofs — visibility and redaction

Before the first mutation, emit a sanitized Human-Only planned/start row listing eligible steps. Afterward emit sanitized, bounded per-target success/failure/skip results and restart evidence. No row enters model context.

Sanitize command output before it reaches session entries or status files. Tests include token-, home-, URL-, and credential-shaped stderr/stdout.

### Deletion gate

Delete:

- one-shot abandon-if-busy timer;
- coupled all-or-nothing result;
- transient-only completion reporting;
- unsanitized persisted command summaries.

### Required gate

Mandatory gate, including real event sequencing, support-window edges, full suite, sanitized update artifacts, and narrow/wide planned/final row QA.

### Hard stops

- If overlap with an agent turn cannot be prevented or aborted safely, skip/defer automatic execution.
- If an exact in-window Pi target or compatible package target cannot be established without custom package management, skip that target and report the upstream API gap.
- Any redaction failure prevents persistence and execution completion reporting.

---

## R7 — Final release gate

This gate does not repair an earlier milestone. Every originating slice must already be green.

### Required outputs

- affected extension manifests and READMEs;
- generated catalog/orientation/command docs from manifests only;
- adoption ledger, changelog, roadmap, and troubleshooting updates;
- public-sanitized live artifacts or stable artifact references;
- explicit residual risks and deferred upstream requests.

### Aggregate checks

```bash
npm run generate-catalog
npm run format:check
npm run check
npm test
npm run docs:health:check
npm run docs:build
npm run eslint
bash scripts/check-llm-artifacts.sh
npm run validate:ci
```

## Dependency graph

```text
P0 secure native secret prompt
 |
 v
M1 audited fixed-patch runtime + native Docs/Slack auth
 |\
 | +------------------------------> E4 SF Skills parity evidence
 |
 +--> M2A active-branch context --> P5 Browser pilot
 |
 +--> M2B human-only output ------> M6 update coordinator
 |
 +--> M2C DevBar public facts
 |
 +--> M2D capability-only max ----> M3A complete Gateway Provider --> M3B legacy-token cutoff
 |
 +--> M2E Herdr real event shapes
 |
 +--> M2F catalog event attestation

Accepted outcomes -----------------------------------------------> R7 release gate
```

## Definition of done

- The supported Pi range is truthful in package metadata, runtime gate, and required edge CI.
- Native secret entry is observably masked and non-echoed.
- No production source references `ModelRegistry.authStorage` or writes `auth.json`.
- Gateway project configuration accepts no new secret.
- Legacy Gateway token execution fallback ends after the announced window without deleting user files.
- Active model context is branch-correct and latest-value for mutable facts.
- Automatic human status never pollutes model context.
- Gateway `max` is capability-only.
- The complete Gateway Provider passes auth/logout, offline, refresh, override, transport, compaction, retry, drift, diagnostics, spend, and live gates; legacy orchestration is deleted.
- SF DevBar consumes only public Pi facts and shows unknown context honestly.
- SF Skills has a reviewed parity matrix before any Funnel deletion.
- Browser activation has an explicit keep/stop decision and rollback proof.
- Auto Update preserves consent, settlement, compatibility, redaction, and durable human visibility.
- Generated docs/catalogs were updated in each originating slice and remain green at release.
- Full CI, docs, security, and public-sanitization gates pass.

## Residual risks requiring escalation

- Upstream Pi may choose a different secure-secret or provider-login interface; use its public solution rather than preserving plan mechanics.
- Existing Docs/Slack credential shapes may need explicit migration if Pi cannot resolve them safely beside canonical auth.
- Gateway routes and provider storage cannot be proven from types alone.
- Pi resource resolution may not preserve every Funnel convenience; parity results return for user decision.
- Dynamic activation may not improve cache behavior on custom Gateway routes even when correctness passes.
- Automatic Pi/package target planning may remain unavailable publicly; skipping is preferable to a custom updater.

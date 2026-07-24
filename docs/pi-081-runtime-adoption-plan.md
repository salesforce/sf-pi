# Pi 0.81 Runtime Adoption Plan

Status: complete for Pi 0.81.1; shared Gateway/Docs/Slack secure login, M2A–M2F, E4 retain evidence, M3A, M3B, and M6 are complete; P5 stopped before implementation; R7 passed

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
- The pre-adoption baseline was green on the locked runtime: 457 test files and 3,407 tests passed.
- SF Pi declares 41 LLM tools; Browser, Data 360, and Slack own 31.

## Non-goals

- No implementation before separate authorization.
- No private Pi imports, direct `auth.json` writes, or duplicate secret store.
- No old/new production Provider paths after parity.
- No dynamic tool loading or package-wide capability router in the current adoption program.
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
| P0  | deletion milestone    | Shared SF Pi fixed-mask provider login with Pi-owned persistence        | M1                                      |
| C0  | completed containment | Compatibility/auth claims fail safely while credential entry is blocked | none                                    |
| M1  | deletion milestone    | Pi 0.81.1 runtime window with contained Docs/Slack auth                 | C0                                      |
| M2A | deletion milestone    | Active-branch latest context                                            | M1                                      |
| M2B | deletion milestone    | Display-only output is model-invisible                                  | M1                                      |
| M2C | correction milestone  | DevBar consumes nullable public Pi facts correctly                      | M1                                      |
| M2D | deletion milestone    | Gateway `max` is capability-only                                        | M1                                      |
| M2E | deletion milestone    | Herdr uses real Pi event shapes                                         | M1                                      |
| M2F | correction milestone  | Catalog attests actual Code Analyzer hooks                              | M1                                      |
| M3A | deletion milestone    | Complete native Gateway Provider                                        | M1, M2A, M2D                            |
| M3B | deletion milestone    | Legacy config-token execution fallback ends                             | one released migration window after M3A |
| E4  | evidence gate         | SF Skills Pi-vs-Funnel parity matrix                                    | M1                                      |
| P5  | stopped pilot         | Eager Browser/SF tool activation retained; no dynamic layer implemented | M2A                                     |
| M6  | deletion milestone    | Agent-Settled Update Coordinator                                        | M1, M2B                                 |
| R7  | release gate          | Final evidence, docs, and sanitization                                  | all accepted outcomes                   |

---

## P0 — Shared secure provider credential prompt

Implementation status: implemented for Gateway, SF Docs, and SF Slack on Pi 0.81.1.

### Objective

Provide secure interactive token entry without depending on Pi's visible stock prompt or owning credential persistence.

### Implementation

- `lib/common/secure-credential-prompt.ts` owns one session-bound fixed-mask `ctx.ui.custom()` component;
- `lib/common/auth-only-provider.ts` gives Docs and Slack complete no-model Providers with API-key and OAuth-compatible auth;
- Gateway consumes the same shared component and deletes its extension-local copy;
- Docs and Slack bind/clear the bridge on session lifecycle, prepare native `/login`, and return canonical credentials to Pi;
- Pi alone persists credentials and owns `/logout`; environment fallbacks remain unchanged;
- RPC, JSON, and print modes reject interactive entry and retain existing/environment auth paths.

### Behavior proof

- fixed-length mask while typing, with no credential fragments in narrow/wide rendering;
- Kitty input, bracketed paste, terminal-control filtering, grapheme deletion, Escape, abort, reload, shutdown, and rebind behavior;
- no stock prompt callback invocation;
- API-key and OAuth-compatible credentials resolve through Pi's public Models API;
- existing credential shapes remain usable and native logout removes Pi-owned credentials;
- no private auth import, direct `auth.json` write, second secret store, session entry, config field, status line, or terminal echo.

### Deletion gate

Delete Docs/Slack containment-only login failures and copy, plus the Gateway-local secure prompt after all three providers use the shared implementation.

### Hard stops

- Masked editing with post-submit echo does not pass.
- The component never writes credentials or bypasses Pi persistence/logout.
- Provider-specific copies of the shared prompt are prohibited.

Implementation evidence:

- exact Pi 0.81.1 TUI login for Docs and Slack rendered the provider-specific shared component, persisted OAuth-compatible credentials at mode `0600`, and native logout removed them;
- provider-specific token sentinels appeared in neither terminal capture, status, session/config files, nor public evidence;
- Pi public Models tests cover API-key login/logout, OAuth compatibility, and environment precedence without invoking the stock prompt callback;
- common component tests cover fixed masks, Kitty input, paste, terminal controls, grapheme deletion, cancellation, abort, rebind, and non-TUI refusal;
- sanitized evidence: `/tmp/sf-pi-r7-shared-credential-evidence.json`.

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

Implementation status: implemented.

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

Implementation evidence:

- `shouldInjectOnce` consumes Pi's public `buildContextEntries()` projection and evaluates only the latest matching custom message;
- SF Brain, DevBar, Guardrail, and Slack register latest-value context projections;
- real `SessionManager` tests cover active/abandoned siblings, repeated compaction, resume, fork, tree navigation, and A→B→A;
- projection tests preserve unrelated messages and state-only approval/audit records and prove multiple projection handlers compose;
- Slack drops stale workspace context when identity/tools become inactive and restores it when active;
- Guardrail enforcement remains in the independent `tool_call` seam;
- full validation passes 460 test files and 3,433 tests; production audit is clean.

### Hard stop

Any filtering of state-only entries or hard Guardrail enforcement stops the slice.

---

## M2B — Human-only command output

Implementation status: implemented.

### Objective

Make display-only Gateway and Feedback command reports model-invisible.

### Likely files

- `extensions/sf-llm-gateway-internal/index.ts`
- `extensions/sf-feedback/index.ts`
- related message renderers and mode-behavior tests

### Red proofs

TUI, RPC, print, and JSON/headless reports remain visible through the correct human channel, but no newly emitted display-only report creates a `custom_message` for later model context. Only actionable findings may queue an agent-visible follow-up.

### Deletion gate

Delete display-only `sendMessage()` calls and any renderer left with no other purpose.

### Required gate

Mandatory gate and mode-by-mode artifact; TUI QA only if visible output changes.

Implementation evidence:

- Gateway and Feedback share one mode-aware output boundary: existing TUI panels, RPC notifications, JSON custom-entry events, and print-mode console output;
- headless reports emit `custom` entries rather than new `custom_message` entries;
- exact Pi 0.81.1 CLI tests exercise both commands in RPC, JSON, and print modes; component tests preserve the existing TUI panel rendering;
- real `SessionManager.buildSessionContext()` proof excludes state-only report entries, and secret-shaped values are redacted before append;
- display-only `sendMessage()` calls and the Gateway message renderer are deleted.

Compatibility note: pre-M2B session history remains append-only. Existing legacy
`custom_message` rows are not rewritten, and Pi 0.81.1 can still include those
historical rows in compaction or branch summarization. M2B prevents new
display-only command reports from creating that legacy shape.

---

## M2C — DevBar public-runtime fact correction

Implementation status: implemented.

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

Implementation evidence:

- the DevBar adapter consumes Pi's public nullable `ContextUsage.percent` and public session name without token arithmetic or session-history parsing;
- absent context remains absent, explicit post-compaction unknown renders `unknown`, exact zero renders `0.0%`, and fractional values keep one-decimal display plus partial-cell precision;
- Pi's `session_info_changed` event repaints a bounded, lowest-priority session-name segment;
- narrow and wide renderer tests enforce terminal-width bounds, including when the right-side LSP segment is wider than the terminal;
- SF DevBar continues to omit Pi-owned aggregate usage and cache accounting;
- combined M2B/M2C validation passes 467 test files and 3,469 tests; the production dependency audit is clean.

---

## M2D — Capability-only Gateway `max`

Implementation status: implemented.

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

Implementation evidence:

- SF Pi issues zero `ExtensionAPI.setThinkingLevel()` calls and writes no `defaultThinkingLevel`; model selection, startup repair, enable, disable, set-default, and GPT-5.6 migration preserve Pi/user thinking settings;
- passive thinking state, Gateway default-thinking constants, resolver fields, saved previous-thinking state, and test-only accessors are deleted;
- exact Pi 0.81.1 RPC tests preserve `low` through startup, Gateway commands, and model switches while Pi's real capability selector exposes `max` only on proven families;
- read-only live probes cover Claude, Codex, GPT-5.5, GPT-5.6 direct/Bedrock, and a high-ceiling GPT-5 control without retaining endpoints, credentials, or payloads;
- the registry currently exposes only Pi 0.81.1 inside `>=0.81.1 <0.82.0`, so the floor and latest-window edge are the same exact package for this gate.

---

## M2E — Real Herdr event shapes

Implementation status: implemented.

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

Implementation evidence:

- SF Herdr consumes Pi's exported `ToolResultEvent.input` and deletes the invented `HerdrToolExecutionEndEvent` plus the redundant end observer;
- exported-shape tests cover successful Agent Script, Data 360, Apex, LWC, Browser, Herdr run, and write/edit activity, with failed results excluded from inference;
- an exact Pi 0.81.1 faux-provider probe proves `tool_execution_start → tool_result → tool_execution_end`, validated input on `tool_result`, and no `args` on the end event;
- each successful activity produces one signal instead of the previous duplicate weighting;
- resume/tree reconstruction pairs persisted assistant tool-call arguments with successful results by call id, preserving Herdr commands and write/edit paths while excluding failures;
- the manifest and generated catalog/docs declare `tool_result` without `tool_execution_end`;
- combined M2D/M2E validation passes 469 test files and 3,490 tests; the production dependency audit is clean.

---

## M2F — Catalog event attestation

Implementation status: implemented.

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

Implementation evidence:

- Code Analyzer's manifest now reports `session_start`, `tool_result`, `agent_settled`, and `session_shutdown`;
- an exact extension-factory test captures every real `pi.on()` registration and compares that set with the manifest;
- delegated event declarations use a narrow docs-health allowlist tied to an exact extension-factory attestation test instead of relying on broad source scanning or manifest-selected test paths;
- generated catalog, registry, orientation, and extension docs list the two previously omitted hooks.

---

## M3A — Complete Gateway Provider replacement

Implementation status: implemented and released in v0.235.0.

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
3. read-only legacy project token;
4. read-only legacy global token.

Rules:

- no setup/import path can save a new global or project secret;
- native login can be verified while a legacy token remains because native auth wins;
- status identifies the source and migration deadline without showing the token;
- user may explicitly remove the legacy field only after native verification;
- v0.235.0 is the migration-window release; M3B may end legacy execution no earlier than v0.236.0;
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

Implementation evidence:

- exact Pi 0.81.1 `/login` reviewed the non-secret URL (Enter keeps the current value), then used the production SF Pi fixed-mask component for the API key;
- Pi persisted the canonical `ApiKeyCredential` with URL metadata at mode `0600`; no Gateway config file was created, the token sentinel appeared in neither terminal capture, and native `/logout` removed the credential;
- one complete Provider now owns the synchronous baseline, Pi `ModelsStore` overlay, auth resolution, and API-map dispatch; configured endpoints are materialized per request and never persisted in the model catalog;
- live complete-Provider probes pass Chat/Codex, OpenAI Responses, Anthropic tool/thinking, and Pi compaction routes;
- deterministic tests pass Responses-to-Chat fallback, Anthropic bounded early-stream retry, Chat payload/service-tier shaping, offline restore, refresh failure/abort retention, sentinel filtering, drift handling, and topmost `models.json` overrides;
- the custom model cache, cached/repeated registration, delayed discovery timer, pseudo-OAuth marker, API-tag stripping, ID dispatcher, and superseded architecture tests are deleted;
- sanitized evidence: `/tmp/sf-pi-m3a-production-login-proof.json`, `/tmp/sf-pi-m3a-url-review-proof.json`, and `/tmp/sf-pi-m3a-provider-evidence.json`;
- aggregate validation passes 469 test files and 3,523 tests, with 5 test files and 8 tests skipped; docs build, lint, production audit, and live Gateway gates are clean.

---

## M3B — End legacy config-token execution fallback

Implementation status: implemented after the v0.235.0-v0.236.0 migration window.

### Objective

End the bounded compatibility read path after the announced migration window.

### Red proofs

- legacy-only project and global config tokens are no longer used for requests after the cutoff;
- status detects its presence without printing or using it and gives native login/removal guidance;
- native and environment credentials continue to work;
- no file content is silently deleted.

### Deletion gate

Delete legacy token request precedence and execution use. Retain only non-secret detection needed for migration guidance until a later user-authorized cleanup.

### Required gate

Mandatory gate at both runtime-window edges plus sanitized migration artifacts.

Implementation evidence:

- Provider authentication resolves only Pi-owned credentials, `SF_LLM_GATEWAY_API_KEY`, or its legacy environment alias; project/global saved `apiKey` fields never satisfy Pi auth checks or reach requests;
- effective non-secret Gateway configuration no longer returns any API-key value or source, while saved-field presence remains available only to status, setup preservation, and explicit cleanup paths;
- stale saved-vs-environment key-conflict hashing, persisted state, probe output, and Welcome rendering are deleted because the saved value is never active;
- status and setup surfaces identify inactive legacy fields without values and direct users to `/login` plus verified `remove-legacy-token` cleanup;
- native login/logout and environment fallback tests remain green, legacy-only project/global fixtures resolve no auth and remain byte-for-byte unchanged, and cleanup still requires native verification plus confirmation;
- an exact Pi 0.81.1 RPC lifecycle keeps a distinct saved legacy field inactive while an environment credential remains usable across Gateway off/on transitions;
- Pi 0.81.1 is both the exact supported floor and latest release inside `>=0.81.1 <0.82.0`, so the runtime-window edge gate is one exact package;
- aggregate validation passes 476 test files and 3,558 tests, with 5 test files and 8 tests skipped; sanitized evidence: `/tmp/sf-pi-m3b-evidence.json`.

---

## E4 — SF Skills Resource Resolution Parity Proof

Implementation status: evidence complete; closeout retains current SF Skills governance and authorizes no production deletion.

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

Implementation evidence:

- one isolated harness uses Pi's public `DefaultPackageManager`, `DefaultResourceLoader`, `SettingsManager`, `loadSkills`, and `loadSkillsFromDir` exports against temporary settings and skill trees;
- native parity is proven for global inheritance, additive top-level project scope, project-only loading, project trust, missing-root omission, known duplicate precedence, and the resulting state of one-skill rescope;
- package `autoload:false` deltas, exact resource filters, and complete package/default-root collision inventory are semantic disagreements because the Funnel does not model package/filter resources;
- stale-root diagnostics, one-skill rescope workflow, managed pack lifecycle, external source discovery, labels/prune, and usage awareness remain Salesforce-specific leverage;
- whole-source rescope is recorded as a current semantic disagreement: independently expanding each sibling re-adds the full global set. E4 deliberately does not fix it;
- no useful generic upstream gap was established, and ADRs 0017/0018 remain in force pending explicit follow-up decisions;
- combined M2F/E4 validation passes 467 test files and 3,498 tests, with 4 test files and 6 tests skipped; `validate:ci`, docs build, and the production dependency audit are clean.

---

## P5 — SF Browser Progressive Tool Activation Pilot

Implementation status: stopped before implementation by product decision; Pi's eager tool activation remains authoritative.

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

### Keep/stop/expand outcome

- **Stop selected before implementation.** No production layer, state, manifest change, or provider compatibility flag landed.
- The current adoption program retains Pi's normal eager active set and authoritative exclusions.
- Dynamic loading requires separate future authorization and does not block R7.

---

## M6 — Agent-Settled Update Coordinator

Implementation status: implemented and released in v0.236.0.

### Objective

Keep Auto Update while replacing the one-shot startup race with a consent-preserving, bounded coordinator.

### Likely files

- `extensions/sf-pi-manager/lib/auto-update-command.ts`
- `extensions/sf-pi-manager/lib/auto-update-coordinator.ts`
- `extensions/sf-pi-manager/lib/auto-update-package-plan.ts`
- `extensions/sf-pi-manager/lib/auto-update-runner.ts`
- `extensions/sf-pi-manager/lib/auto-update-transcript.ts`
- `extensions/sf-pi-manager/index.ts`
- `lib/common/auto-update/store.ts` and machine lock
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

Implementation evidence:

- startup records due interactive work as pending and performs no mutation; the exact extension factory registers `agent_start` and `agent_settled`, never `agent_end`;
- the next settled boundary rechecks opt-in and idle state, emits a sanitized Human-Only plan before mutation, and persists bounded Pi-runtime, Pi-package, and Salesforce CLI outcomes;
- a new agent turn aborts the current command and defers remaining automatic work; opt-out, reload, shutdown, headless mode, an active machine lock, and fresh running state all prevent overlap;
- Pi self-update remains skipped because Pi 0.81.1 exposes no bounded in-window target; this removes the `PI_SKIP_VERSION_CHECK` failure path reported in #500 without clearing the user's environment;
- global npm Pi packages receive a bounded read-only metadata preflight and per-package Pi-native update only when the latest version is newer and declares compatible Pi and Node ranges; pinned, local, git, project, incompatible, malformed, custom-npm-command, and unverifiable sources are skipped;
- outdated unpinned Herdr is included through the generic package policy; current or constrained Herdr installs remain untouched;
- atomic lock, total package-update budget, command abort signals, fixed-result summaries, and capture-time credential/home/URL redaction keep execution and persisted evidence bounded;
- SF Welcome now recognizes both legacy `herdr` and current `herdr_layout`, `herdr_pane`, and `herdr_agent` tools, resolving #514 independently of the updater;
- focused store, lock, planner, coordinator, transcript, real-factory sequencing, real Pi 0.81 RPC lifecycle, manager command, Welcome, and Herdr status behavior tests pass; sanitized evidence: `/tmp/sf-pi-m6-evidence.json`;
- aggregate validation passes 476 test files and 3,556 tests, with 5 test files and 8 tests skipped; docs build, lint, generated-catalog checks, LLM-artifact checks, and the production dependency audit are clean.

---

## R7 — Final release gate

Implementation status: complete for the Pi 0.81.1 adoption program.

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

Closeout evidence:

- every implemented deletion/correction milestone is green at the exact supported Pi 0.81.1 runtime edge;
- P5 is explicitly stopped with no production rollback required;
- E4 is complete with current SF Skills governance retained and package/rescope differences recorded as separate future work;
- Gateway, Docs, and Slack share one secure provider input boundary with Pi-owned persistence/logout;
- aggregate validation passes 477 test files and 3,562 tests, with 5 test files and 8 tests skipped;
- generated docs/catalog, formatting, typecheck, ESLint, docs build, LLM-artifact, production audit, and public-sanitization gates pass;
- sanitized final evidence: `/tmp/sf-pi-r7-shared-credential-evidence.json`.

## Dependency graph

```text
M1 audited fixed-patch runtime + contained auth
 |\
 | +--> P0 shared secure provider login for Gateway, Docs, and Slack
 | +--> E4 SF Skills parity evidence (retain decision)
 |
 +--> M2A active-branch context --> P5 Browser pilot (stopped before implementation)
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
- Gateway, Docs, and Slack share one observably masked, non-echoed provider credential component while Pi owns persistence/logout.
- No production source references `ModelRegistry.authStorage` or writes `auth.json`.
- Gateway project configuration accepts no new secret.
- Legacy Gateway token execution fallback ends after the announced window without deleting user files.
- Active model context is branch-correct and latest-value for mutable facts.
- Automatic human status never pollutes model context.
- Gateway `max` is capability-only.
- The complete Gateway Provider passes auth/logout, offline, refresh, override, transport, compaction, retry, drift, diagnostics, spend, and live gates; legacy orchestration is deleted.
- SF DevBar consumes only public Pi facts and shows unknown context honestly.
- SF Skills has a reviewed parity matrix before any Funnel deletion.
- Browser activation has an explicit stop decision; no production layer landed, so no rollback is required.
- Auto Update preserves consent, settlement, compatibility, redaction, and durable human visibility.
- Generated docs/catalogs were updated in each originating slice and remain green at release.
- Full CI, docs, security, and public-sanitization gates pass.

## Residual risks requiring escalation

- The shared credential component depends only on public Pi 0.81.1 provider and `ctx.ui.custom()` APIs; any future Pi interface change requires a new support-window audit.
- Gateway routes and provider storage cannot be proven from types alone; existing live/runtime gates remain required.
- E4 found package/filter and whole-source rescope semantic disagreements. The current adoption outcome retains SF Skills governance and authorizes no broad deletion; future fixes require separate scope.
- Dynamic tool activation was deliberately not adopted and requires separate future authorization.
- Automatic Pi/package target planning may remain unavailable publicly; skipping is preferable to a custom updater.
- A moderate `protobufjs` advisory remains confined to the exact Pi development dependency tree; the SF Pi production audit is clean.

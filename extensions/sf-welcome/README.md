# SF Welcome — Code Walkthrough

## What It Does

Salesforce-branded splash screen that displays on startup with an animated Pi + SALESFORCE wordmark and a two-column layout:

**Left column:**

- Animated Pi + SALESFORCE wordmark with Salesforce-blue and pastel-rainbow palettes
- Active model name and provider
- Gateway-sourced monthly usage line when the active provider is SF LLM Gateway
- Optional Slack and auth-gated LLM Gateway status only when enabled/configured,
  plus lightweight SF CLI install/latest, Node.js runtime floor, Homebrew
  status, Herdr multiplexer readiness, bundled font status, Hunk code-review
  readiness, SF Browser `agent-browser` runtime status, Native Auto Update
  status, and Node CA certificate status
- **Privacy row** showing pi's anonymous-telemetry posture
  (`telemetry off (sf-pi default)` / `(user override)` / `telemetry on (user
override)`). Driven by `lib/common/privacy/state.ts` — see
  [`extensions/sf-pi-manager/README.md`](../sf-pi-manager/README.md) for the
  full decision matrix and the `/sf-pi telemetry` command surface.
- **Release freshness rows** for SF Skills, sf-pi, and the Pi runtime. The
  sf-pi row also carries the bundled-extension active/total count so the
  splash avoids a separate redundant extension-health row.

**Right column:**

- **Announcements panel** (top of the column): maintainer notes from
  the bundled `catalog/announcements.json`, plus any entries from the
  optional remote feed and a synthetic update nudge when the installed
  sf-pi version is behind `latestVersion`. The splash renders the top 3
  active items after severity/date sorting; use `/sf-pi announcements`
  for full bodies and the complete list. Dismissed via
  `/sf-pi announcements dismiss <id>`, disabled entirely via
  `SF_PI_ANNOUNCEMENTS=off` or `{ "sfPi": { "announcements": false } }`.
- Loaded counts (extensions, skills, prompt templates)
- Recent sessions with relative timestamps
- Recommended external pi packages (top 4 pending items) and skill-source nudges
- Community attribution

## Runtime Flow

```
Extension loads
  └─ session_start (reason="startup")
       ├─ sfPi.welcome.mode=off → skip
       └─ otherwise → show non-blocking persistent header (Esc dismiss)

Dismissal triggers:
  ├─ Any keypress (overlay)
  ├─ Escape (header)
  ├─ agent_start (LLM responds)
  └─ tool_call (agent working)

session_shutdown
  └─ clear overlay/header state, reset animation flags, and unsubscribe usage-store listeners
```

## Key Architecture Decisions

1. **Separate data collection from rendering** — `splash-data.ts` gathers all information,
   `splash-component.ts` handles TUI rendering. This keeps rendering pure and testable.

2. **Cost estimation from session files** — Scans `.jsonl` session files modified this month,
   extracts `usage.cost.total` from assistant messages. Approximate but zero-config.

3. **Extension health from the generated registry** — Reads `catalog/registry.ts`
   for bundled extension metadata and combines it with settings.json filter state.
   This keeps the welcome screen aligned with the actual bundle list.

4. **Non-blocking startup header** — Startup renders as a persistent header so
   users can type while cache-first rows refresh. `sfPi.welcome.mode=off` disables
   the startup surface entirely. The older full overlay remains in code for visual
   previews and explicit future surfaces, but automatic startup no longer uses a
   capturing overlay.

5. **Lightweight SF CLI status** — The welcome screen checks only
   `sf --version` plus an optional npm-registry lookup so it can show
   `SF CLI installed · latest` without running org/config detection. Full
   org/API context belongs to sf-devbar.

6. **Release freshness is cache-first** — sf-pi release freshness reads the
   local package version and the bundled/cached announcements feed on first
   paint, then piggybacks on the deferred announcements refresh. Pi runtime,
   SF CLI, SF Skills, and SF Browser freshness checks respect `PI_OFFLINE` and
   `PI_SKIP_VERSION_CHECK`; skipped checks render as calm "latest check skipped"
   labels instead of warnings. The SF Skills row separates **Managed Source
   Availability** from current-project **Skill Gate** wiring: the orange
   `Install official skills` nudge appears only when no sentinel-managed
   `afv-library` checkout exists, while an unwired local checkout renders as
   `afv-library available` with a quiet enable hint. When npm release-age
   gating is configured, the Pi runtime row compares against the newest package
   version npm can currently install and renders a cooldown-active latest label
   instead of a false update warning. Update hints render only when a newer
   installable version is known.

7. **Optional integration rows stay quiet** — Slack and LLM Gateway rows are
   hidden unless their bundled extensions are enabled and have meaningful live
   status. Optional local tools such as Hunk, Code Analyzer, and Native Auto
   Update render with calm optional labels when absent or off, and become
   warning-colored only when an enabled or installed setup is degraded. This
   keeps installs from seeing unavailable or unconfigured integrations as
   startup noise.

8. **Background loading** — CLI status, release freshness, font readiness,
   Hunk code-review readiness, Homebrew status, SF Browser `agent-browser`
   runtime status, Native Auto Update status, Node CA certificate status,
   gateway usage, and remote announcements refresh asynchronously after the splash appears, so startup
   remains responsive while the visible rows update in place. Node.js and Herdr
   readiness stays startup-safe: process-local pane-control env plus a small
   settings.json package check for `npm:@ogulcancelik/pi-herdr` and a bounded
   header read of Herdr's managed Pi state extension. Font detection is local-only
   and cache-first; Hunk, Homebrew, and `agent-browser` use deferred bounded
   version/prefix probes and never open a review UI, browser, Chrome/CDP
   session, Herdr pane, or package-manager update from the splash. Node
   CA detection is local-only and cache-first: first paint reads
   `sf-welcome/node-cert-status.json`, then a deferred detector checks
   `NODE_EXTRA_CA_CERTS`, the sf-pi CA fixer state, LaunchAgent/shell exports,
   and bounded known PEM candidates without network calls, subprocesses, or
   recursive filesystem scans.

9. **Salesforce brand gradient** — Uses actual Salesforce brand colors (#0070D2 blue,
   #01C3E2 Astro cyan, #9061F9 purple) for the Pi logo gradient.

10. **Terminal-aware glyph policy** — Every emoji/box icon on the splash
    (and in the sf-devbar bottom bar) routes through
    `lib/common/glyph-policy.ts`. On terminals known to lack emoji font
    fallback (notably macOS Terminal.app, detected via
    `TERM_PROGRAM=Apple_Terminal`), the policy swaps in ASCII equivalents
    (`⚡` → `»`, `💰` → `$`, `📦` → `[]`, …) so users see readable
    status instead of `?` tofu. Users can override via
    `SF_PI_ASCII_ICONS=1`/`0` or `sfPi.asciiIcons: true|false` in
    `settings.json`.

11. **Narrow-terminal single-column fallback** — Below ~100 columns the
    splash stacks its two columns vertically so no content is truncated.
    Above that threshold the two-column layout grows up to 220 columns
    wide, filling wide terminals instead of leaving an ellipsised island.

12. **Top-left anchored overlay** — The splash hugs the top-left corner
    of the terminal with a 1-col left margin so it sits flush with pi's
    own prompt and bottom bar instead of floating center-screen on
    wide terminals.

13. **Bundled Nerd Font installer** — Four MesloLGM Nerd Font Mono TTFs
    ship under `assets/fonts/`. `/sf-setup-fonts` copies them into
    `~/Library/Fonts` (macOS) or `~/.local/share/fonts` (Linux) with
    SHA-256 verification, idempotent on repeat runs, and best-effort
    cache refresh via `atsutil` / `fc-cache`. Windows users get manual
    install instructions.

14. **One-time install prompt** — When the splash detects ASCII-fallback
    glyphs _and_ the font isn't installed _and_ the user hasn't been
    asked before, `sf-welcome` shows a single `ctx.ui.confirm()` dialog:
    "Install bundled Nerd Font?" The decision (yes or no) is persisted
    in `~/.pi/agent/sf-welcome-state.json` under `fontInstallDecision`,
    so the prompt never fires again on that machine. `/sf-setup-fonts`
    remains available as an explicit escape hatch.

## Behavior Matrix

| Event/Trigger    | Condition                     | Result                                    |
| ---------------- | ----------------------------- | ----------------------------------------- |
| session_start    | reason="startup", mode≠off    | Show persistent header                    |
| session_start    | reason≠"startup"              | Skip (resume, reload, fork)               |
| agent_start      | overlay/header visible        | Dismiss                                   |
| tool_call        | overlay/header visible        | Dismiss                                   |
| any keypress     | overlay visible               | Dismiss                                   |
| Escape           | header visible                | Dismiss                                   |
| session_shutdown | —                             | Clear overlay/header state and listeners  |
| /sf-welcome      | always                        | Show text summary                         |
| /sf-setup-fonts  | always                        | Install bundled Nerd Font + refresh cache |
| session_start    | ascii + no font + never asked | Ask once, persist answer, never re-ask    |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-welcome/
  assets/
    fonts/
      LICENSE               ← bundled asset metadata
      SOURCE.md             ← bundled asset metadata
  lib/
    ca-bundle-nudge.ts      ← implementation module
    config-panel.ts         ← implementation module
    extension-health.ts     ← implementation module
    font-installer.ts       ← implementation module
    font-status-cache.ts    ← implementation module
    font-status.ts          ← implementation module
    herdr-runtime-status.ts ← implementation module
    homebrew-status.ts      ← implementation module
    hunk-status.ts          ← implementation module
    node-cert-cache.ts      ← implementation module
    node-cert-status.ts     ← implementation module
    recommendations-status.ts← implementation module
    release-status.ts       ← implementation module
    session-data.ts         ← implementation module
    sf-cli-status.ts        ← implementation module
    sf-skills-status.ts     ← implementation module
    splash-component.ts     ← implementation module
    splash-data.ts          ← implementation module
    startup-mode.ts         ← implementation module
    state-store.ts          ← implementation module
    types.ts                ← implementation module
    welcome-settings.ts     ← implementation module
  tests/
    announcements-filter.test.ts← unit / smoke test
    announcements-manifest.test.ts← unit / smoke test
    announcements-orchestrator.test.ts← unit / smoke test
    announcements-state.test.ts← unit / smoke test
    announcements-update.test.ts← unit / smoke test
    ca-bundle-nudge.test.ts ← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    extension-health.test.ts← unit / smoke test
    font-installer.test.ts  ← unit / smoke test
    font-status-cache.test.ts← unit / smoke test
    herdr-runtime-status.test.ts← unit / smoke test
    homebrew-status.test.ts ← unit / smoke test
    hunk-status.test.ts     ← unit / smoke test
    node-cert-status.test.ts← unit / smoke test
    recommendations-status.test.ts← unit / smoke test
    release-status.test.ts  ← unit / smoke test
    sdk-migration.test.ts   ← unit / smoke test
    session-data.test.ts    ← unit / smoke test
    sf-cli-status.test.ts   ← unit / smoke test
    sf-skills-status.test.ts← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    splash-privacy.test.ts  ← unit / smoke test
    splash-release-status.test.ts← unit / smoke test
    splash-sf-skills.test.ts← unit / smoke test
    splash-wordmark-shadow.test.ts← unit / smoke test
    startup-mode.test.ts    ← unit / smoke test
    state-store.test.ts     ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Preview Tooling

The splash header has small script-level previews so visual tweaks can be
reviewed without launching a full pi session:

```bash
node scripts/preview-pi-salesforce.mjs
node scripts/preview-sf-logo.mjs
node scripts/render-splash-header.mjs
```

Use these only for local visual QA; runtime behavior still lives in
`splash-component.ts` and is covered by the tests above.

## Persistent State

`~/.pi/agent/sf-welcome-state.json` records local SF Welcome preferences such
as the one-time bundled font prompt decision. Older installs may still carry a
legacy `lastSeenPiVersion` key; SF Welcome preserves it on write but no longer
uses it because upstream Pi owns Pi Runtime release-note surfaces.

`<globalAgentDir>/sf-pi/sf-welcome/pi-release-status.json` caches the Pi
runtime latest-version result for 24 hours. The splash also caches font, Hunk,
and Homebrew readiness under `<globalAgentDir>/sf-pi/sf-welcome/font-status.json`,
`<globalAgentDir>/sf-pi/sf-welcome/hunk-status.json`, and
`<globalAgentDir>/sf-pi/sf-welcome/homebrew-status.json`. SF Browser owns the
shared `agent-browser` runtime cache at
`<globalAgentDir>/sf-pi/sf-browser/agent-browser-status.json`; SF Welcome only
reads it cache-first and refreshes it with a deferred version probe. Native Auto
Update status lives at `<globalAgentDir>/sf-pi/auto-update/status.json`. sf-pi
release freshness reuses the announcements state/cache under
`<globalAgentDir>/state/sf-pi/announcements.json`.

## Testing Strategy

Run: `npm test`

- **Smoke tests**: Module exports, component instantiation, render output shape
- **Registry alignment tests**: Verifies extension health stays aligned with the generated registry
- **Narrow terminal handling**: Verifies graceful empty output below minimum width
- **Announcements / recommendations**: Verifies bundled manifest loading, merge/filter rules, and splash summaries
- **Manual QA**: Full visual testing in terminal with `pi` or the preview scripts above (overlay rendering, dismissal, animation)

## Troubleshooting

**Splash shows `?` boxes (tofu) where glyphs should be:**
Your terminal font cannot render the emoji/box glyphs and the terminal
doesn't fall back to a color emoji font. This is common on macOS
Terminal.app and some Powerlevel10k setups. Fixes:

- Run `/sf-setup-fonts` to install the bundled MesloLGM Nerd Font.
- Force ASCII glyphs for one session: `SF_PI_ASCII_ICONS=1 pi`.
- Persist in `~/.pi/agent/settings.json` (or `.pi/settings.json`):
  ```json
  { "sfPi": { "asciiIcons": true } }
  ```
- iTerm2 / Ghostty / WezTerm / VS Code terminals don't need any of the
  above — they fall back to the color emoji font on their own.

**Herdr says the upstream package or Pi state integration is missing:**
The actual `herdr` tool comes from the upstream Pi package
`npm:@ogulcancelik/pi-herdr`; SF Herdr only plans Salesforce workflow lanes.
There is no separate Herdr skill to install. Run
`pi install npm:@ogulcancelik/pi-herdr`, then start Pi from inside a Herdr pane
so `HERDR_ENV`, `HERDR_PANE_ID`, and the upstream tool are active. For richer
Pi lifecycle/session state in Herdr, also run `herdr integration install pi`.
Herdr writes `herdr-agent-state.ts` into Pi's global extensions directory. If
the package is already configured but the tool is still inactive inside Herdr,
run `/reload` and check package filters in Pi settings.

**Splash feels too busy, stuck, or setup warnings are noisy:**
Startup now uses the compact non-blocking header by default. Press Esc to
dismiss it, or switch **SF Pi Manager → SF Welcome → Settings** to `overlay`
when you prefer the full splash. The setting writes Pi's existing
`quietStartup` preference (`header` = `quietStartup:true`, `overlay` =
`quietStartup:false`). For recovery launch, `SF_PI_SAFE_START=1 pi` still
resolves to the same non-blocking header so users can repair the harness from
inside pi.

**Splash content gets truncated in a narrow terminal:**
Fixed — below ~100 columns the splash now stacks to a single column instead
of clipping the right-hand tips panel. Above that width it grows up to 220
columns.

**`/sf-setup-fonts` says everything is already installed but the splash still shows ASCII:**
The install is idempotent and verified by SHA-256. Two likely causes:
(a) your terminal is still configured to use a non-Nerd font — set it to
**MesloLGM Nerd Font Mono** and reopen the terminal; (b) your terminal
caches glyphs aggressively — `atsutil server -shutdown` on macOS or
`fc-cache -f` on Linux forces a refresh.

**I was asked to install the font once and declined — how do I get the prompt back?**
The decision is persisted in `~/.pi/agent/sf-welcome-state.json` under
`fontInstallDecision` so we don't re-ask. Run `/sf-setup-fonts` directly
to install anyway, or edit that file if you want the one-time prompt
back.

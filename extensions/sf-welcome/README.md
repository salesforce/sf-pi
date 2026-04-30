# SF Welcome — Code Walkthrough

## What It Does

Salesforce-branded splash screen that displays on startup with a two-column layout:

**Left column:**

- Gradient Pi logo (blue → cyan → purple, Salesforce brand palette)
- Active model name and provider
- Monthly cost usage line with color-coded progress (green → orange → red)
- Lifetime usage line — per-key spend from the gateway, or a local session-file estimate for bring-your-own-keys users
- sf-pi extension health grid (active/disabled/locked indicators)
- Slack connection status

**Right column:**

- **Announcements panel** (top of the column): maintainer notes from
  the bundled `catalog/announcements.json`, plus any entries from the
  optional remote feed and a synthetic update nudge when the installed
  sf-pi version is behind `latestVersion`. Max 3 items, one line each.
  Dismissed via `/sf-pi announcements dismiss <id>`, disabled entirely
  via `SF_PI_ANNOUNCEMENTS=off` or `{ "sfPi": { "announcements": false } }`.
- **What's New panel** (only after a pi-coding-agent version bump) with feature + fix bullets distilled from the bundled CHANGELOG.md
- Quick tips (commands, bash, thinking toggle, sf-pi manager)
- Loaded counts (extensions, skills, prompt templates)
- Recent sessions with relative timestamps
- Salesforce AI compliance indicators (OSS-safe, Core AI principles, Trusted AI)
- Community attribution

## Runtime Flow

```
Extension loads
  └─ session_start (reason="startup")
       ├─ quietStartup=false → show overlay (30s countdown, any-key dismiss)
       └─ quietStartup=true  → show persistent header (cleared on first input)

Dismissal triggers:
  ├─ Any keypress
  ├─ agent_start (LLM responds)
  ├─ tool_call (agent working)
  └─ Countdown reaches 0
```

## Key Architecture Decisions

1. **Separate data collection from rendering** — `splash-data.ts` gathers all information,
   `splash-component.ts` handles TUI rendering. This keeps rendering pure and testable.

2. **Cost estimation from session files** — Scans `.jsonl` session files modified this month,
   extracts `usage.cost.total` from assistant messages. Approximate but zero-config.

3. **Extension health from the generated registry** — Reads `catalog/registry.ts`
   for bundled extension metadata and combines it with settings.json filter state.
   This keeps the welcome screen aligned with the actual bundle list.

4. **Overlay vs header modes** — Matches Pi's startup precedence rules.
   `quietStartup: true` in settings.json switches to a non-blocking header,
   while `--verbose` overrides quiet startup and forces the overlay.

5. **Shared Salesforce detection** — SF environment lookup is delegated to the
   shared Salesforce environment runtime cache, so startup only runs one set of
   SF CLI commands even when both extensions need org details.

6. **Last-known snapshot first** — The welcome screen reads the persisted shared
   cache synchronously and shows recent org info immediately when available.

7. **Background loading** — A forced refresh still runs asynchronously after the
   splash appears, so the snapshot can update in place without blocking input.

8. **Freshness hints** — Cached snapshots show subtle `updated … ago`, `cached`,
   and `refreshing…` hints so you can tell whether the splash is showing a warm
   cache or freshly detected data.

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

| Event/Trigger   | Condition                     | Result                                      |
| --------------- | ----------------------------- | ------------------------------------------- |
| session_start   | reason="startup", quiet=false | Show overlay with countdown                 |
| session_start   | reason="startup", quiet=true  | Show persistent header                      |
| session_start   | reason≠"startup"              | Skip (resume, reload, fork)                 |
| session_start   | first-ever launch             | Persist current pi version, omit What's New |
| agent_start     | overlay/header visible        | Dismiss + persist seen pi version           |
| tool_call       | overlay/header visible        | Dismiss + persist seen pi version           |
| any keypress    | overlay visible               | Dismiss + persist seen pi version           |
| countdown=0     | overlay visible               | Auto-dismiss + persist seen pi version      |
| /sf-welcome     | always                        | Show text summary                           |
| /sf-setup-fonts | always                        | Install bundled Nerd Font + refresh cache   |
| session_start   | ascii + no font + never asked | Ask once, persist answer, never re-ask      |

## File Structure

```
extensions/sf-welcome/
  index.ts                   ← Entry point, event handlers, overlay/header setup
  manifest.json              ← Metadata
  README.md                  ← This file
  lib/
    splash-data.ts           ← Aggregate splash payload + loaded counts + Slack check
    types.ts                 ← Shared splash data contracts
    session-data.ts          ← Recent sessions + monthly/lifetime cost estimation
    extension-health.ts      ← Registry-driven extension health discovery
    startup-mode.ts          ← quietStartup + --verbose precedence helper
    sf-environment.ts        ← Welcome adapter for shared SF environment detection
    splash-component.ts      ← TUI components (SfWelcomeOverlay, SfWelcomeHeader)
    whats-new.ts             ← CHANGELOG.md parser + version-aware summarizer
    announcements.ts         ← Orchestrator: bundled + remote + update-nudge
    announcements-manifest.ts← Loader for catalog/announcements.json
    announcements-filter.ts  ← Pure merge/filter/sort rules (dismiss, expiry, version)
    announcements-remote.ts  ← Optional feed fetch (timeout, ETag, silent-fail)
    announcements-update.ts  ← Synthetic "update available" builder
    announcements-state.ts   ← ~/.pi/agent/state/sf-pi/announcements.json
    state-store.ts           ← ~/.pi/agent/sf-welcome-state.json persistence
    font-installer.ts        ← /sf-setup-fonts installer (copy, sha-verify, cache refresh)
  assets/
    fonts/                   ← Bundled MesloLGM Nerd Font Mono TTFs + OFL license
  tests/
    smoke.test.ts              ← Module export + render smoke tests
    startup-mode.test.ts       ← quietStartup + --verbose precedence checks
    extension-health.test.ts   ← Registry + settings precedence checks
    sf-environment.test.ts     ← Shared-cache adapter + persisted snapshot behavior
    whats-new.test.ts          ← CHANGELOG parse, version compare, summarization
    state-store.test.ts        ← Persistent state roundtrip + corruption handling
    font-installer.test.ts     ← Install idempotency, sha verification, platform dispatch
```

## Persistent State

`~/.pi/agent/sf-welcome-state.json` records the pi-coding-agent version the
user has most recently acknowledged (via a dismissed splash). The What's New
panel appears only when the installed pi version is strictly greater than
that stored value. First-ever launches seed the file eagerly and show no
panel, so a fresh install is never noisy.

## Testing Strategy

Run: `npm test`

- **Smoke tests**: Module exports, component instantiation, render output shape
- **Registry alignment tests**: Verifies extension health stays aligned with the generated registry
- **Narrow terminal handling**: Verifies graceful empty output below minimum width
- **Manual QA**: Full visual testing in terminal with `pi` (overlay rendering, countdown, dismissal)

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

**Splash feels too busy or you want it out of the way:**
Enable the compact header mode: `"quietStartup": true` in the same
`settings.json`. The dismissable splash is replaced by a single persistent
header above the prompt. `--verbose` on the pi CLI overrides and forces
the overlay.

**Splash content gets truncated in a narrow terminal:**
Fixed — below ~100 columns the splash now stacks to a single column instead
of clipping the right-hand tips panel. Above that width it grows up to 220
columns.

**What's New panel shows on first run or won't go away:**
The panel appears only when the installed pi version is strictly greater
than the version recorded in `~/.pi/agent/sf-welcome-state.json`. First
launches seed that file so no panel shows. Delete the file to resurface
the banner, or let a future version bump supersede it.

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

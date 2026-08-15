# SF Welcome

## What It Does

SF Welcome provides a non-blocking Salesforce startup surface with an animated
Pi + SALESFORCE wordmark and cache-first readiness information.

The default header summarizes the active model, optional gateway usage,
Salesforce CLI and API context, Apex/LWC/Agent Script LSP readiness, Node runtime,
Herdr, Browser, Code Analyzer, fonts, local review tools, release freshness,
privacy posture, announcements, recommended packages, skill sources, and recent
sessions. Optional integrations stay hidden until enabled/configured or
meaningfully degraded.

Wide terminals can show two columns; narrow terminals stack the same content.
`NO_COLOR` preserves text/layout while removing SF Welcome-owned ANSI styling.

## Commands

| Command           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `/sf-welcome`     | Show the current Welcome surface on demand                      |
| `/sf-setup-fonts` | Install the bundled MesloLGM Nerd Font files after confirmation |

## Configuration

**SF Pi Manager → SF Welcome → Settings** controls startup mode through Pi's
`quietStartup` preference:

- `header` — compact non-blocking startup surface;
- `overlay` — full dismissible splash;
- `off` — no automatic Welcome surface.

`SF_PI_SAFE_START=1 pi` uses the non-blocking header for recovery. Glyph policy
can be overridden with `SF_PI_ASCII_ICONS=1`/`0` or `sfPi.asciiIcons`.
Announcements can be disabled with `SF_PI_ANNOUNCEMENTS=off` or
`sfPi.announcements=false`.

The font installer writes only to the user's font directory, verifies bundled
SHA-256 checksums, and is idempotent. Windows receives manual instructions.
Startup prompts once when fallback glyphs indicate the font is missing; the
choice is stored locally and `/sf-setup-fonts` remains available later.

## Preview tooling

Contributors can review the visual header locally without starting a full Pi
session:

```bash
node scripts/preview-pi-salesforce.mjs
node scripts/preview-sf-logo.mjs
node scripts/render-splash-header.mjs
```

These are visual previews only; Behavior Proofs remain authoritative for runtime
state and lifecycle behavior.

## Troubleshooting

**Glyphs render as boxes:** Run `/sf-setup-fonts`, select **MesloLGM Nerd Font
Mono** in the terminal, or force ASCII icons.

**The LSP row stays unknown:** Run `/sf-lsp doctor`. SF Welcome reads shared
readiness and never launches a duplicate probe.

**Herdr reports missing tools:** Install `npm:@ogulcancelik/pi-herdr`, launch Pi
inside a Herdr pane, and install the Herdr Pi bridge when needed.

**Startup feels noisy:** Select `header` or `off` in Manager settings. Optional
integrations should remain calm unless enabled or degraded.

**Content is clipped:** Increase terminal width or report a reproduction. The
surface switches to a single-column layout below its wide-layout threshold.

**Fonts are installed but glyphs remain wrong:** Reopen the terminal after
selecting the bundled font and refresh the platform font cache if necessary.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-welcome/
  assets/                     ← bundled assets and attribution
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  CREDITS.md                  ← extension attribution
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

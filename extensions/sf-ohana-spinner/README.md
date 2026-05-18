# SF Ohana Spinner — Code Walkthrough

## What It Does

Displays a configurable working indicator while the LLM is thinking. Uses Pi's
built-in `ctx.ui.setWorkingIndicator()` API. Every mode starts with an explicit
`Thinking…` state so users can tell pi is still working before reading the
personality text.

Modes:

- **Ohana** — `Thinking…` plus Salesforce-themed rotating ecosystem messages.
- **Calm** — `Thinking… · Processing...` with only the leading spinner glyph animated.

Ohana remains the default for existing users. Users can switch to Calm from the
`/sf-pi` extension manager settings panel.

## Runtime Flow

```
session_start
  ├─ Read sfPi.ohanaSpinner.mode from Pi settings
  ├─ Ohana: install `Thinking… · <message>` rainbow frames and start message rotation timer (5s)
  └─ Calm: install stable `Thinking… · Processing...` frames with no rotation timer

session_shutdown
  ├─ Clear rotation timer if present
  └─ Restore Pi's default working indicator
```

## Key Architecture Decisions

### 1. Soft pastel rainbow colors

Muted tones that work on dark terminal backgrounds. Bright saturated rainbow
would be unreadable on many terminal themes.

### 2. 150ms animation interval

Fast enough for smooth rainbow flow, slow enough to not burn CPU on terminal
repaints.

### 3. 5s message rotation in Ohana mode only

Keeps Ohana mode entertaining without changing Calm mode's stable text. Too
fast and users can't read the jokes; too slow and it gets stale.

### 4. One mode setting

The only preference is `sfPi.ohanaSpinner.mode` with `ohana` as the default and
`calm` as the quieter option. More knobs would make the spinner harder to
understand than the problem requires.

## Behavior Matrix

| Event            | Result                                                      |
| ---------------- | ----------------------------------------------------------- |
| session_start    | Install Ohana or Calm frames from the saved mode preference |
| 5s interval      | Ohana only: rotate to a new random message                  |
| 150ms interval   | Pi advances the configured working-indicator frames         |
| session_shutdown | Clear rotation timer, restore default indicator             |
| No LLM activity  | Silent — Pi only shows the indicator while streaming        |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-ohana-spinner/
  lib/
    config-panel.ts         ← implementation module
    messages.ts             ← implementation module
    rainbow.ts              ← implementation module
    settings.ts             ← implementation module
  tests/
    settings.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Tests cover the message catalog, frame builders, mode settings, and module
export. The live timer lifecycle is tested via manual QA since it depends on
Pi's runtime context.

Run: `npm test`

## Troubleshooting

**Spinner colors look dim, washed-out, or garbled:**
The palette is deliberately muted to stay readable on dark terminal
themes. If the colors look wrong, your terminal may be remapping ANSI
colors aggressively (some Powerlevel10k + terminal-theme combinations do
this). Switch to Calm mode from `/sf-pi`, or disable the extension with
`/sf-pi disable sf-ohana-spinner` if it's more distracting than helpful — Pi's
default spinner takes over.

**No spinner appears during LLM thinking:**
Pi only shows the working indicator while a turn is streaming. If the
turn never reaches the streaming phase (auth failure, model not
resolved, etc.), the spinner stays silent by design. `NO_COLOR=1`
support is on the roadmap; in the meantime, a plain terminal without
color falls back gracefully.

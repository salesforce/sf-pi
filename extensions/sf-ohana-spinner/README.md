# SF Ohana Spinner — Code Walkthrough

## What It Does

Displays a Salesforce-themed rainbow spinner with rotating ecosystem messages
while the LLM is thinking. Uses Pi's built-in `ctx.ui.setWorkingIndicator()` API.

Zero config, zero state between sessions.

## Runtime Flow

```
session_start
  ├─ Pick random message from catalog
  ├─ Install rainbow working indicator frames (150ms animation)
  └─ Start message rotation timer (5s)

session_shutdown
  ├─ Clear rotation timer
  └─ Restore Pi's default working indicator
```

## Key Architecture Decisions

### 1. Soft pastel rainbow colors

Muted tones that work on dark terminal backgrounds. Bright saturated rainbow
would be unreadable on many terminal themes.

### 2. 150ms animation interval

Fast enough for smooth rainbow flow, slow enough to not burn CPU on terminal
repaints.

### 3. 5s message rotation

Keeps it entertaining without being distracting. Too fast and users can't
read the jokes; too slow and it gets stale.

## Behavior Matrix

| Event            | Result                                               |
| ---------------- | ---------------------------------------------------- |
| session_start    | Install rainbow working indicator + start rotation   |
| 5s interval      | Rotate to new random message                         |
| 150ms interval   | Pi advances the configured working-indicator frames  |
| session_shutdown | Clear rotation timer, restore default indicator      |
| No LLM activity  | Silent — Pi only shows the indicator while streaming |

## File Structure

```
extensions/sf-ohana-spinner/
  index.ts              ← entry point (event handlers + rainbow renderer)
  manifest.json         ← metadata
  README.md             ← this file
  lib/
    messages.ts         ← message catalog (pure data)
  tests/
    smoke.test.ts       ← module export + message catalog tests
```

## Testing Strategy

Tests cover the message catalog (format, uniqueness, count) and verify the
module exports correctly. The rainbow animation and timer logic are tested
via manual QA since they depend on Pi's runtime context.

Run: `npm test`

## Troubleshooting

**Spinner colors look dim, washed-out, or garbled:**
The palette is deliberately muted to stay readable on dark terminal
themes. If the colors look wrong, your terminal may be remapping ANSI
colors aggressively (some Powerlevel10k + terminal-theme combinations do
this). Disable the extension with `/sf-pi disable sf-ohana-spinner` if
it's more distracting than helpful — Pi's default spinner takes over.

**No spinner appears during LLM thinking:**
Pi only shows the working indicator while a turn is streaming. If the
turn never reaches the streaming phase (auth failure, model not
resolved, etc.), the spinner stays silent by design. `NO_COLOR=1`
support is on the roadmap; in the meantime, a plain terminal without
color falls back gracefully.

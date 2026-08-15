# SF Ohana Spinner

## What It Does

SF Ohana Spinner replaces Pi's working indicator while the model is thinking.
Every mode begins with `Thinking…` so activity is clear before any personality
text appears:

- **Ohana** — animated pastel color plus rotating Salesforce ecosystem messages.
- **Calm** — the same explicit state with only the leading glyph animated.

Ohana is the default. When `NO_COLOR` is present, text and animation remain while
SF Pi-owned ANSI color is removed.

## Configuration

**SF Pi Manager → SF Ohana Spinner → Settings** stores
`sfPi.ohanaSpinner.mode` as `ohana` or `calm`. Saving shows a reload hint because
the working indicator is installed during session start.

The extension intentionally exposes no additional speed, palette, or message
controls. Disable it in the Manager to restore Pi's default indicator.

## Troubleshooting

**Colors look dim or garbled:** The palette is intentionally muted for dark
terminals. Try Calm mode, set `NO_COLOR`, or disable the extension if the terminal
theme remaps true color poorly.

**No spinner appears:** Pi displays the working indicator only after a turn
reaches the model streaming phase. Authentication or model-resolution failures
can occur before that phase.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-ohana-spinner/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

# SF Ohana Spinner

## What It Does

SF Ohana Spinner supplies optional personality text for Pi's working
indicator while the model is streaming. Pi owns the spinner, color, and
when the cue appears:

- **Ohana** — rotating short Salesforce ecosystem messages.
- **Calm** — Pi's default Working label, with no catalog text.

Ohana is the default. Messages are chrome in the editor-border working
indicator, not a separate status row.

## Configuration

**SF Pi Manager → SF Ohana Spinner → Settings** stores
`sfPi.ohanaSpinner.mode` as `ohana` or `calm`. Saving shows a reload hint because
the working indicator is installed during session start.

The extension intentionally exposes no additional speed, palette, or message
controls. Disable it in the Manager to restore Pi's default indicator.

## Troubleshooting

**No spinner appears:** Pi displays the working indicator only after a turn
reaches the model streaming phase. Authentication or model-resolution failures
can occur before that phase.

**The message looks truncated:** Ohana lines are written to fit the border slot.
Pi may still clip them on a very narrow terminal.

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

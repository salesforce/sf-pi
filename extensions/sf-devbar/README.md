# SF DevBar

## What It Does

SF DevBar renders two non-blocking Salesforce-oriented terminal surfaces:

- a **top bar** with SF Pi branding, model and thinking level, workspace, Git
  state, context usage, optional session name, and non-default image width;
- a **bottom bar** with active gateway usage, SF Pi package count, Salesforce DX
  project and authenticated org context, plus Slack readiness when useful.

Each source loads independently from cached or reactive state. `NO_COLOR` keeps
the same text and layout while removing SF DevBar-owned ANSI styling.

## Commands

| Command               | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `/sf-devbar`          | Open SF DevBar in the Manager; print status without UI       |
| `/sf-devbar status`   | Show current environment details                             |
| `/sf-devbar toggle`   | Toggle both bars                                             |
| `/sf-devbar refresh`  | Recreate the target connection and refresh environment state |
| `/sf-devbar settings` | Open color settings                                          |
| `/sf-devbar help`     | Print help                                                   |
| `/sf-org`             | Show detected Salesforce org status                          |
| `/sf-org refresh`     | Recreate the target connection and refresh org status        |
| `Ctrl+Shift+B`        | Toggle both bars from the TUI                                |
| `pi --no-devbar`      | Start without SF DevBar                                      |

## API version status

`/sf-org` keeps the SFDX project's source API version separate from the
connection API version selected by the Salesforce SDK. An explicit
`org-api-version` override is labeled `configured`. An unexplained SDK fallback
is labeled unverified rather than being presented as the org's release version.

## Configuration

**SF Pi Manager → SF DevBar → Settings** edits colors under
`sfPi.devbar.colors`. Project values override global values per field, then fall
back to the classic palette. Accepted values are `#RGB` and `#RRGGBB`; palettes
accept comma-separated colors in the panel or JSON arrays in settings.

Configurable roles include folder/model text, missing-org warning,
sandbox/trial labels, context bar foreground/background, gateway rainbow, and
thinking rainbow. Production warnings and Git state continue to use semantic
Pi theme colors. `s` saves from the settings list without reloading Pi; `Esc`
cancels a focused field edit.

## Troubleshooting

**The bars do not appear:** SF DevBar skips print/JSON/headless modes. In a TTY,
check `--no-devbar`, then use `/sf-devbar toggle`.

**The org segment stays pending:** Run `/sf-org refresh`. Environment data is
cache-first, so a cold authenticated lookup can take longer than later sessions.

**Context says `unknown`:** Immediately after compaction, Pi can know the window
size while the percentage is unavailable. The percentage returns after the next
assistant turn.

**The gateway badge color is unexpected:** It follows the active model provider
identity. Verify the selected provider/model in Pi before changing colors.

**An `img:Nc` pill appears:** It reflects a non-default
`terminal.imageWidthCells` setting and is intentionally hidden at the default.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-devbar/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  CREDITS.md                  ← extension attribution
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

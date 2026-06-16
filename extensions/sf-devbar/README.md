# SF DevBar — Code Walkthrough

## What It Does

A bespoke Salesforce developer status bar that renders two persistent UI surfaces:

- **Top bar** (widget above editor): SF Pi brand, model name with gateway detection,
  rainbow thinking level, working folder, git branch + changes, context window progress bar,
  a permanent right-aligned **Salesforce LSP segment** (`LSP[Apex: ● | LWC: ● | AgentScript: ●]`)
  fed by sf-lsp via the shared `lib/common/sf-lsp-health` registry, and (when non-default)
  an `img:Nc` pill reflecting `terminal.imageWidthCells`
- **Bottom bar** (custom footer): deterministic left order of active LLM gateway
  monthly budget, SF Pi package count, then `SFDX Project → <authenticated org> [type]`
  only inside a Salesforce DX project; Slack remains right-aligned when `sf-slack`
  is enabled and ready/warning-worthy.

Every data source is async and non-blocking. The bars render immediately with
cached/partial data and fill in as results arrive.

## Runtime Flow

```
Extension loads
  ├─ registerCommand("sf-devbar")
  ├─ registerCommand("sf-org")
  ├─ registerShortcut(Ctrl+Shift+B)
  ├─ session_start      → install top/bottom bars, start async data refresh
  ├─ model_select       → repaint model / gateway badge
  ├─ thinking_level_select → repaint thinking badge
  ├─ turn_start         → show thinking indicator
  ├─ turn_end           → refresh context + footer
  ├─ agent_end          → refresh git state
  └─ session_shutdown   → restore Pi defaults
```

## How It Differs from the Default Pi Footer

| Default Pi footer           | sf-devbar                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ |
| Model name + git branch     | SF-first: org context, gateway badge, thinking level                           |
| No org awareness            | Shows `SFDX Project →` authenticated org and type when inside an SF DX project |
| No context window indicator | Visual progress bar with color-coded usage                                     |
| No package/cost grouping    | Active LLM gateway budget, then SF Pi package count, then org on the left      |
| No git change counts        | Branch + added/modified/deleted counts                                         |
| No SF LLM Gateway detection | Gold badge when using the internal gateway                                     |
| No thinking level display   | Rainbow gradient thinking badge                                                |
| No keyboard toggle          | Ctrl+Shift+B to toggle bars on/off                                             |

## Pi SDK Features Used (25)

### Rendering

- `ctx.ui.setWidget()` — top bar above editor
- `ctx.ui.setFooter()` — bottom bar below editor
- `ctx.ui.setTitle()` — terminal tab title
- `theme.fg()` / `theme.bold()` — all colors and styling

### Events

- `session_start` — activate bars, load data, start async checks
- `session_shutdown` — restore default footer, clear widget
- `model_select` — update model display, detect gateway
- `thinking_level_select` — repaint thinking badge instantly on level change (pi ≥ 0.71; no-op on older)
- `turn_start` — set thinking indicator
- `turn_end` — context refresh + footer repaint
- `agent_end` — final git refresh + footer repaint

### Data Sources

- `pi.getThinkingLevel()` — thinking level for rainbow badge
- `ctx.getContextUsage()` — context window progress bar
- `ctx.model` — model name, provider detection
- `ctx.cwd` — working folder name
- `pi.exec()` — git status
- `footerData.getGitBranch()` — reactive git branch
- `footerData.onBranchChange()` — reactive re-render
- `footerData.getExtensionStatuses()` — other extension statuses
- `ctx.hasUI` — skip rendering in print/JSON mode

### Registration

- `pi.registerCommand()` — `/sf-devbar` status/control panel plus text subcommands
- `pi.registerShortcut()` — Ctrl+Shift+B toggle
- `pi.registerFlag()` — `--no-devbar` CLI flag

## Async Architecture

Every data source loads independently. The bars render immediately and update
as results arrive:

| Data Source      | Timing                                           | Loading State                   |
| ---------------- | ------------------------------------------------ | ------------------------------- |
| SF Environment   | Reads shared sf-environment cache — instant warm | Shows last cached, then updates |
| Model + Thinking | Synchronous from `ctx.model` / thinking API      | Always available                |
| Git branch       | Reactive via `footerData.onBranchChange()`       | Immediate from Pi's tracking    |
| Git changes      | Async `git status` — refreshed on agent_end      | Shows "…" until first result    |
| Context usage    | Recalculated on turn_end                         | Bar starts empty, fills on turn |

## Commands

| Command               | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `/sf-devbar`          | Open SF DevBar in SF Pi Manager; show status in no-UI mode     |
| `/sf-devbar status`   | Show current org/environment details                           |
| `/sf-devbar toggle`   | Toggle bars on/off                                             |
| `/sf-devbar refresh`  | Force Salesforce environment re-detection and settings refresh |
| `/sf-devbar settings` | Open DevBar color settings in SF Pi Manager                    |
| `/sf-devbar help`     | Show help                                                      |
| `/sf-org`             | Show detected Salesforce org status                            |
| `Ctrl+Shift+B`        | Keyboard toggle                                                |
| `pi --no-devbar`      | Launch without status bars                                     |

## Behavior Matrix

| Event/Trigger         | Condition        | Result                                                    |
| --------------------- | ---------------- | --------------------------------------------------------- |
| session_start         | UI available     | Render bars with cached data                              |
| session_start         | `--no-devbar`    | Stay silent                                               |
| model_select          | model changes    | Repaint model/gateway badge                               |
| thinking_level_select | thinking changes | Repaint rainbow thinking badge                            |
| turn_end / agent_end  | —                | Refresh context, footer, and git state                    |
| session_shutdown      | —                | Clear custom widget/footer                                |
| `/sf-devbar`          | UI available     | Open SF Pi Manager detail page for SF DevBar              |
| `/sf-devbar`          | no UI            | Show current status                                       |
| `/sf-devbar toggle`   | —                | Toggle enabled state                                      |
| `/sf-devbar refresh`  | —                | Force environment re-detection and color settings refresh |
| `/sf-devbar settings` | UI available     | Open SF Pi Manager settings for DevBar colors             |
| `/sf-org`             | —                | Show Salesforce environment summary                       |

## Color Preferences

DevBar colors are configurable from **SF Pi Manager → SF DevBar → Settings**
or directly with `/sf-devbar settings` in TUI mode. Settings are saved in
Pi's native settings files under `sfPi.devbar.colors`.

Project settings override global settings per field; omitted fields inherit
from the next source and ultimately from the classic DevBar defaults. Invalid
manual JSON values fail soft and fall back to the next valid source.

```json
{
  "sfPi": {
    "devbar": {
      "colors": {
        "folderPath": "#5fafff",
        "modelName": "#d7afff",
        "orgWarning": "#ffaf5f",
        "sandboxTrial": "#82d8ff",
        "contextEmptyFg": "#5c5c66",
        "contextEmptyBg": "#24242a",
        "gatewayRainbow": ["#b281d6", "#5fafff", "#82d8ff"],
        "thinkingRainbow": ["#d7afff", "#ffaf5f", "#82d8ff"]
      }
    }
  }
}
```

Accepted color formats are `#RGB` and `#RRGGBB`; the settings panel normalizes
values to lowercase `#rrggbb`. Palette fields accept comma-separated colors in
the panel, or JSON arrays in settings files. Press `Enter` on a color row to open
a focused edit page with a visible draft cursor; `Esc` cancels that field edit
and returns to the settings list.

Only DevBar-owned hardcoded true-color accents are configurable. Semantic theme
colors such as production warnings, LSP success/error states, and git status
colors continue to come from the active Pi theme.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-devbar/
  lib/
    bottom-bar.ts           ← implementation module
    colors.ts               ← implementation module
    config-panel.ts         ← implementation module
    git-changes.ts          ← implementation module
    settings-reader.ts      ← implementation module
    settings.ts             ← implementation module
    top-bar.ts              ← implementation module
  tests/
    bottom-bar.test.ts      ← unit / smoke test
    colors.test.ts          ← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    git-changes.test.ts     ← unit / smoke test
    settings-reader.test.ts ← unit / smoke test
    settings.test.ts        ← unit / smoke test
    shutdown-reason.test.ts ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    system-prompt-options.test.ts← unit / smoke test
    top-bar-lsp.test.ts     ← unit / smoke test
    top-bar.test.ts         ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Dependencies

- **shared Salesforce environment runtime** — reads `getCachedSfEnvironment()` from the
  shared runtime cache. Zero duplicate CLI calls.
- **sf-llm-gateway-internal** — detected by provider name (`sf-llm-gateway-internal`)
  from `ctx.model.provider`. No import dependency, just a string match.

## Testing Strategy

All renderers and helpers are pure and testable:

- `top-bar.ts` / `bottom-bar.ts` — tested with a stub theme that returns marker strings
- `git-changes.ts` — tested with real porcelain output
- No real CLI/git calls in tests — everything is mocked

## Troubleshooting

**Bars don't appear at all:**
Confirm you have a TTY — sf-devbar skips rendering in `pi -p` / JSON /
print mode via `ctx.hasUI`. If you're in a real terminal, try
`/sf-devbar` to open controls or `/sf-devbar toggle` to toggle. The `--no-devbar` CLI flag suppresses rendering
for the session if you've launched with it.

**Org segment shows `…` or takes a long time:**
Org data is async and shared with sf-welcome via the
`lib/common/sf-environment/` cache. The first warm-up after a cold
start calls the SF CLI; subsequent sessions read the persisted snapshot
instantly. If it never resolves, run `sf org display --json` directly to
confirm the CLI can see the org.

**Context bar starts empty and doesn't fill:**
Context usage is recalculated on `turn_end`. The bar fills after the
first assistant turn. If you expect it to fill immediately, you're
looking for `ctx.getContextUsage()` — that's the data source.

**Gateway badge color is wrong when using sf-llm-gateway-internal:**
The gold badge triggers on `ctx.model.provider === "sf-llm-gateway-internal"`
or the Anthropic-native provider. If your selected model is routed under
one of those names in `/sf-llm-gateway-internal models`, the badge will
match.

**`img:Nc` pill appears unexpectedly:**
It reflects a non-default `terminal.imageWidthCells` setting in
`~/.pi/agent/settings.json` or `.pi/settings.json`. The pill is hidden at
the default value; any override surfaces it so the change is visible.

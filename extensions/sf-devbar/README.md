# SF DevBar — Code Walkthrough

## What It Does

A bespoke Salesforce developer status bar that renders two persistent UI surfaces:

- **Top bar** (widget above editor): SF Pi brand, model name with gateway detection,
  rainbow thinking level, working folder, git branch + changes, context window progress bar,
  a permanent right-aligned **Salesforce LSP segment** (`Apex: ● | LWC: ● | AgentScript: ●`)
  fed by sf-lsp via the shared `lib/common/sf-lsp-health` registry, and (when non-default)
  an `img:Nc` pill reflecting `terminal.imageWidthCells`
- **Bottom bar** (custom footer): Salesforce org name + type, connection status,
  SF CLI version with freshness check, and selected sf-pi extension statuses
  (SF Pi packages, LLM gateway monthly budget, Slack connection pill)

Every data source is async and non-blocking. The bars render immediately with
cached/partial data and fill in as results arrive.

## How It Differs from the Default Pi Footer

| Default Pi footer           | sf-devbar                                              |
| --------------------------- | ------------------------------------------------------ |
| Model name + git branch     | SF-first: org context, gateway badge, thinking level   |
| No org awareness            | Shows org name, type (sandbox/prod), connection status |
| No context window indicator | Visual progress bar with color-coded usage             |
| No CLI version info         | CLI version + async freshness check (latest vs update) |
| No git change counts        | Branch + added/modified/deleted counts                 |
| No SF LLM Gateway detection | Gold badge when using the internal gateway             |
| No thinking level display   | Rainbow gradient thinking badge                        |
| No keyboard toggle          | Ctrl+Shift+B to toggle bars on/off                     |

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
- `pi.exec()` — git status, npm view (CLI freshness)
- `footerData.getGitBranch()` — reactive git branch
- `footerData.onBranchChange()` — reactive re-render
- `footerData.getExtensionStatuses()` — other extension statuses
- `ctx.hasUI` — skip rendering in print/JSON mode

### Registration

- `pi.registerCommand()` — `/sf-devbar` toggle
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
| CLI freshness    | Async `npm view` — once per session              | Shows version until check done  |

## Commands

| Command           | Description                |
| ----------------- | -------------------------- |
| `/sf-devbar`      | Toggle bars on/off         |
| `/sf-devbar help` | Show help                  |
| `Ctrl+Shift+B`    | Keyboard toggle            |
| `pi --no-devbar`  | Launch without status bars |

## File Structure

```
extensions/sf-devbar/
  index.ts              ← entry point (events, commands, shortcuts, wiring)
  manifest.json         ← metadata
  README.md             ← this file
  lib/
    top-bar.ts          ← pure renderer: model, thinking, folder, git, context bar, image-width pill
    bottom-bar.ts       ← pure renderer: org, CLI, extension statuses
    git-changes.ts      ← async git status → +added ~modified -deleted
    cli-freshness.ts    ← async npm view check — is CLI up to date?
    settings-reader.ts  ← Pi project/global settings reader for terminal.* values
  tests/
    smoke.test.ts       ← module export check
    top-bar.test.ts     ← all top-bar segment states
    bottom-bar.test.ts  ← all footer segment states
    git-changes.test.ts ← git status parsing + formatting
    cli-freshness.test.ts ← version comparison tests
    settings-reader.test.ts ← terminal.imageWidthCells scope + parsing
```

## Dependencies

- **shared Salesforce environment runtime** — reads `getCachedSfEnvironment()` from the
  shared runtime cache. Zero duplicate CLI calls.
- **sf-llm-gateway-internal** — detected by provider name (`sf-llm-gateway-internal`)
  from `ctx.model.provider`. No import dependency, just a string match.

## Testing Strategy

All renderers and helpers are pure and testable:

- `top-bar.ts` / `bottom-bar.ts` — tested with a stub theme that returns marker strings
- `git-changes.ts` — tested with real porcelain output
- `cli-freshness.ts` — tested with version comparison edge cases
- No real CLI/git calls in tests — everything is mocked

## Troubleshooting

**Bars don't appear at all:**
Confirm you have a TTY — sf-devbar skips rendering in `pi -p` / JSON /
print mode via `ctx.hasUI`. If you're in a real terminal, try
`/sf-devbar` to toggle. The `--no-devbar` CLI flag suppresses rendering
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

**CLI freshness check never updates:**
`cli-freshness.ts` runs a single `npm view` once per session. Network
failure or proxy issues leave the version unannotated. Skip by ignoring
the badge; it never blocks other data.

**Gateway badge color is wrong when using sf-llm-gateway-internal:**
The gold badge triggers on `ctx.model.provider === "sf-llm-gateway-internal"`
or the Anthropic-native provider. If your selected model is routed under
one of those names in `/sf-llm-gateway-internal models`, the badge will
match.

**`img:Nc` pill appears unexpectedly:**
It reflects a non-default `terminal.imageWidthCells` setting in
`~/.pi/agent/settings.json` or `.pi/settings.json`. The pill is hidden at
the default value; any override surfaces it so the change is visible.

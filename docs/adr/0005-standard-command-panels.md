# ADR 0005: Standard Pi-Native Command Panels

## Status

Accepted

## Context

SF Pi now ships enough slash-command surfaces that discoverability is becoming a
product problem. Some extensions have a compact Pi-native action panel, while
others rely on text-only help, ad hoc setup wizards, or a bespoke full-screen
manager overlay. Users should not need to memorize every subcommand under names
like `/sf-llm-gateway-internal`, and troubleshooting flows such as doctor,
probe, refresh, and health checks should explain themselves before the user runs
them.

The current baseline is mixed:

| Extension                      | Current primary surface                                                       | Gap against the standard                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `sf-lsp`                       | `/sf-lsp` opens a compact `DynamicBorder` + `SelectList` status/actions panel | This is the target pattern.                                                                |
| `sf-pi-manager`                | `/sf-pi` opens a bespoke custom overlay with list/detail/config routing       | Powerful, but different from every other extension and more code to maintain.              |
| `sf-llm-gateway-internal`      | Text status/help plus a custom setup/config flow                              | Too many subcommands; completions are incomplete and mostly lack descriptions.             |
| `sf-guardrail`                 | Text status/list/audit commands plus a config panel in the manager            | Needs a no-args action panel that groups status, rules, audit, forget, and preset install. |
| `sf-slack`                     | Text status/help plus settings panel and many agent tools                     | Needs a no-args action panel for auth, refresh, settings, sent audit, and help.            |
| `sf-agentscript-assist`        | Minimal doctor/check text commands                                            | Needs a small status/actions panel.                                                        |
| `sf-devbar`                    | Toggle command and `/sf-org` text summary                                     | Needs a small status/actions panel for toggle, org status, and help.                       |
| `sf-feedback`                  | Guided feedback wizard                                                        | Wizard can stay, but diagnostics/help should be discoverable as actions.                   |
| `sf-skills-hud`, `sf-welcome`  | Mostly passive UI with simple commands                                        | Lightweight action panels are optional but should follow the same shape when added.        |
| `sf-brain`, `sf-ohana-spinner` | Passive/no-command extensions                                                 | No panel needed; manager/catalog detail is enough.                                         |

## Decision

Use the `sf-lsp` panel style as the standard interactive command surface for SF
Pi extensions:

1. **No-args slash command opens an action panel** when `ctx.hasUI` is true.
   Headless/print/RPC modes fall back to concise text status plus help.
2. **Panels are Pi-native TUI components**, built from existing primitives such
   as `DynamicBorder`, `SelectList`, `SettingsList`, `Text`, and `Spacer`.
   Avoid one-off custom routers unless the surface truly needs custom rendering
   like the startup splash.
3. **Every action has a label and description.** Descriptions must explain what
   the action does and any safety/troubleshooting implication. The description is
   rendered in the panel and reused in command completions when possible.
4. **One action catalog drives panel, help, and completions.** Extensions should
   define their command metadata once and reuse it for:
   - `getArgumentCompletions()` with `AutocompleteItem.description`
   - `/extension help`
   - the no-args action panel
   - extension README command tables
5. **Canonical subcommands are visible; aliases remain accepted.** Help and
   panels show canonical names like `doctor`, `refresh`, `setup`, `models`, and
   `tokens`. Parsers may keep short aliases such as `dr`, but aliases should not
   be the only discoverability path.
6. **Config panels are for settings, not navigation.** Existing
   `lib/config-panel.ts` implementations can remain, but they should be opened
   from the standard action panel or the manager detail page as a settings
   action. The manager should not be the only path to configure an extension.
7. **Diagnostics and health actions are first-class.** Troubleshooting commands
   such as `doctor`, `probe`, `health`, `refresh`, `install status`, and `sent`
   should be grouped under clear section labels and should use action
   descriptions that explain when to run them.
8. **Enable/disable remains centralized in SF Pi Manager**, because it mutates
   Pi package filters and reloads the runtime. Other extension panels may offer
   extension-local on/off behavior, but bundled extension enable/disable should
   link users back to `/sf-pi`.

## Target panel shape

A standard extension panel should fit this skeleton:

```text
<Extension Name> — status & controls

Status
  <short health/config/runtime lines>

Actions
  Refresh status        Re-probe connection or runtime state
  Open settings         Edit saved config for this extension
  Run doctor            Diagnose setup problems and print repair steps
  Show help             Print the complete command reference
  Close                 Dismiss this panel

↑↓ navigate • enter select • esc close
```

For implementation, prefer a small shared helper under
`lib/common/command-panel/` after at least two more extensions need the same
component. Until then, copy the simple `sf-lsp/lib/panel.ts` pattern instead of
building a broad abstraction prematurely.

A shared action type should be intentionally small:

```ts
type SfPiCommandAction = {
  id: string;
  label: string;
  description: string;
  command?: string;
  section?: "status" | "setup" | "diagnostics" | "tools" | "help";
  danger?: "none" | "confirm" | "write";
  run(ctx: ExtensionCommandContext): Promise<void>;
};
```

## Migration plan

1. **Inventory and metadata**
   - Add per-extension command/action metadata where command surfaces are larger
     than one or two subcommands.
   - Make `getArgumentCompletions()` return descriptions, not only labels.
   - Fix drift where parsers accept commands that completion/help omit.

2. **Gateway first**
   - Convert `/sf-llm-gateway-internal` no-args from text-only status into a
     status/actions panel.
   - Group actions: setup/on/off, refresh/models, doctor/usage-probe/debug,
     tokens/onboard, beta/help.
   - Ensure every subcommand has a short description and appears in completion,
     help, and README.

3. **Configurable extensions**
   - Add standard panels to `sf-guardrail` and `sf-slack` that launch their
     existing config/settings panels from a clearly described action.
   - Keep existing HITL confirmation behavior unchanged.

4. **Manager simplification**
   - Replace the bespoke `/sf-pi` overlay with a standard list/action panel or a
     thin catalog browser that reuses the same command-panel primitives.
   - Keep enable/disable, scope selection, recommendations, announcements,
     skills, and doctor behavior, but expose them through the shared interaction
     vocabulary instead of a separate custom UI language.

5. **Small command extensions**
   - Add lightweight panels only where useful (`sf-agentscript-assist`,
     `sf-devbar`, `sf-feedback`).
   - Leave passive extensions alone unless users ask for controls.

## Consequences

- Users get one mental model: type the extension command, scan status, pick an
  action with visible descriptions.
- Slash completion becomes self-documenting because subcommands carry
  descriptions.
- Existing text commands remain scriptable and stable.
- Some bespoke UI code can be removed from `sf-pi-manager` over time.
- The first migration should avoid a large shared framework. Extract common code
  only once the pattern has repeated enough to prove the abstraction.

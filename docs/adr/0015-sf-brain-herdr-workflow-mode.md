# ADR 0015: SF Brain provides conditional Herdr Workflow Mode

## Status

Accepted

## Context

Herdr can orchestrate terminal panes, tabs, workspaces, and long-running command
output for agent workflows. In sessions started inside a Herdr-managed pane,
Pi may already have Herdr-native tool calls available for splitting panes,
reusing existing tabs, submitting commands, reading output, and waiting for
process or agent readiness. That active Pi → Herdr control path is provided by
the `npm:@ogulcancelik/pi-herdr` package, which registers the `herdr` tool only
inside Herdr panes. A separate `herdr-agent-state.ts` integration installed by
Herdr reports Pi working/idle/blocked state back to Herdr over a socket; that is
passive Herdr → Pi visibility and not required for pane control.

Not every SF Pi user starts Pi inside Herdr, and some users will not have Herdr
installed. SF Pi must therefore preserve normal Pi operation when Herdr is not
available. It should not add a hard startup dependency, auto-launch Herdr,
replace Pi's terminal UI, or duplicate Herdr's own tool surface.

There are three architectural tensions:

1. **Where the support lives.** A standalone `sf-herdr` Bundled Extension would
   be visible and independently toggleable, but it would imply SF Pi owns a
   Herdr runtime surface. The immediate need is lighter: teach agents when to
   use the existing Herdr tools.
2. **How availability is detected.** Herdr-specific guidance should appear only
   when the current process is actually in a Herdr-managed pane and the Herdr
   tool surface is active for the turn. Tool availability alone can be stale or
   misleading; environment detection alone does not guarantee the model can call
   the tool.
3. **How prompt context avoids staleness.** SF Brain usually injects persistent
   hidden `custom_message` entries. A standalone persistent Herdr block could
   survive when the same Pi session is later resumed outside Herdr, causing the
   model to believe Herdr is available when it is not.

## Decision

SF Pi v1 Herdr support is an **Opportunistic Herdr Adapter** implemented as
conditional **Herdr Workflow Mode** guidance in SF Brain, not as a new Bundled
Extension and not as new LLM-callable tools.

SF Brain adds a compact Herdr workflow contract to the existing
`<sf_pi_extensions>` context only when both conditions are true:

1. The current process is running inside a Herdr-managed pane, identified by the
   active-control Herdr environment contract (`HERDR_ENV=1` and
   `HERDR_PANE_ID`).
2. The Herdr tool surface from `npm:@ogulcancelik/pi-herdr` is active in
   `event.systemPromptOptions.selectedTools`.

When either condition is false, SF Brain does not add Herdr-specific workflow
guidance. Normal Pi and SF Pi behavior continues unchanged.

The guidance stays compact: availability plus rules for when and how to use
Herdr. It should tell agents to:

- use Herdr for long-running, parallel, or pane-oriented workflows;
- prefer reusing existing panes/tabs before creating new ones;
- create friendly pane aliases for reusable lanes such as tests, server, logs,
  preview, or eval;
- preserve current UI focus unless the user asks otherwise or visible
  interaction is required;
- use Herdr reads/watches for command output and readiness instead of blocking
  the main Pi pane;
- keep quick one-shot commands and normal file edits on the ordinary tool path;
- fall back to normal operation if Herdr is unavailable or a Herdr action fails.

Detailed workflow recipes remain out of the injected context. They may be added
later as docs or runbooks once repeated workflows prove stable.

## Consequences

- SF Pi remains safe for users who do not use Herdr: no startup probe, no hidden
  dependency, no auto-handoff, and no command failures caused by missing Herdr.
- Agents get Herdr-aware behavior only in sessions where Herdr pane control is
  actually usable.
- V1 does not duplicate Herdr system tools, pane APIs, or lifecycle management.
- No new `sf-herdr` extension is created for V1. A future extension remains
  possible if SF Pi later needs a visible command, status panel, doctor provider,
  settings surface, or shared Herdr state consumed by multiple extensions.
- Placing the guidance inside `<sf_pi_extensions>` lets the existing "follow the
  latest block" rule supersede older Herdr-active context when a session's
  environment or selected tool set changes.
- The prompt footprint stays small and architecture-level; workflow catalogs do
  not become always-on model context.

## Alternatives considered

### Standalone `sf-herdr` Bundled Extension

Rejected for v1. It would be appropriate if SF Pi owned a user-facing Herdr
control surface such as `/sf-herdr status`, `/sf-herdr doctor`, configuration,
or additional LLM-callable tools. The current goal is guidance for existing
Herdr tools, so a new extension would add structure before there is a stable
surface to own.

### Requiring the passive Herdr socket bridge

Rejected for Herdr Workflow Mode activation. The passive bridge is useful for
Herdr's sidebar/status awareness, but the agent's ability to orchestrate panes
comes from the active `herdr` tool. Requiring `HERDR_SOCKET_PATH` would suppress
workflow guidance in sessions where pane control works but passive status
reporting is not installed.

### Persistent standalone `<sf_herdr_environment>` custom message

Rejected because it can become stale when a session started inside Herdr is
resumed outside Herdr. Dynamic availability belongs in the existing extension
context that already handles changing runtime state.

### Per-turn system prompt mutation

Viable, but not chosen for v1. The existing `<sf_pi_extensions>` context already
communicates active tools and extension-first routing, and it has a freshness
mechanism based on content changes. Keeping Herdr guidance there avoids another
context channel.

### Always-on Herdr fallback guidance

Rejected because it adds prompt tax to users who do not use Herdr and may nudge
agents toward unavailable tooling. Herdr support must be opportunistic.

## Follow-up work

- Keep Herdr Workflow Mode compact until repeated workflows prove stable enough
  for documented runbooks.
- Revisit a dedicated `sf-herdr` extension only after SF Pi needs a user-facing
  command/status/settings surface or shared Herdr state.

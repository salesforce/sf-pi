# ADR 0031: Pi 0.79 agent-workflow alignment

## Status

Accepted

## Context

Pi 0.78.1 and 0.79.0 added runtime surfaces that overlap with SF Pi code:

- `ctx.mode`, which distinguishes TUI, RPC, JSON, and print modes even when `ctx.hasUI` is true;
- command-time `ctx.getSystemPromptOptions()` for inspecting Pi's actual prompt inputs;
- Project Trust for project-local settings, resources, instructions, and packages;
- native footer cache-hit visibility; and
- package asset path helpers such as `getPackageDir()`.

ADR 0019 deliberately avoided raising SF Pi's minimum Pi Runtime while adopting the 0.77/0.78-safe subset. That posture preserved compatibility, but it also left SF Pi carrying custom compatibility code and TUI assumptions that make agent workflows in RPC/SDK modes less native than they need to be.

## Decision

Adopt Pi 0.79.0 as SF Pi's minimum Pi Runtime for the next alignment slice.

This slice prioritizes **Pi Runtime ownership** over SF Pi-owned custom code:

1. SF Pi's shared standard command/info surfaces become **mode-aware**: `ctx.mode === "tui"` keeps rich custom panels, RPC uses Pi-native dialog/notification methods, and print/JSON avoid TUI rendering. Bespoke TUI-only surfaces remain explicit follow-up work.
2. SF Pi should preserve native Pi footer behavior where possible so new runtime indicators such as prompt cache-hit visibility remain visible.
3. SF Pi uses Pi's public package asset/version helpers instead of rediscovering the Pi package through `node_modules` path walking or package-export workarounds.
4. Future work that reads project-local Pi inputs must respect Pi Project Trust rather than independently treating `.pi`, project instructions, or project resources as trusted.

## Consequences

- SF Pi can delete older compatibility discovery code and rely on Pi 0.79 public exports.
- RPC/SDK agent workflows get first-class behavior for the shared `/sf-*` command and info surfaces instead of being routed into TUI-only `ctx.ui.custom()` components because `ctx.hasUI` is true.
- Users keep Pi's native footer improvements unless an SF Pi extension has a strong reason to replace the footer.
- This supersedes ADR 0019's compatibility-preserving no-floor-bump posture for new Pi 0.79-specific work. ADR 0019 still records the earlier 0.77/0.78 adoption rationale.

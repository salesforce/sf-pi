# SF LSP — Roadmap

Phased plan for the agentic LSP TUI reimagination. Phase 1–3 are shipped.
Future phases are listed here so additional work stays scoped without
growing `index.ts`.

## ✅ Phase 1 — presence (shipped)

- [x] **In-card LSP panel** inside `write` / `edit` tool cards via
      `registerTool` + `renderResult` delegating to `createEditTool` /
      `createWriteTool`. Reads `details.sfPiDiagnostics` — zero
      duplication with `feedback.ts`.
- [x] **Live working indicator** (`ctx.ui.setWorkingIndicator`) flips to a
      themed `⠋ LSP Apex…` spinner while diagnostics are being fetched.
- [x] **Footer status segment** via `ctx.ui.setStatus("sf-lsp", …)`. Picked
      up automatically by `sf-devbar` through `footerData.getExtensionStatuses()`.

## ✅ Phase 2 — continuous visibility (shipped)

- [x] **Below-editor widget** — compact `LSP · file ok 312ms · Apex LWC AS`
      summary line via `setWidget` with `placement: "belowEditor"`.
- [x] **Top-right HUD overlay** — non-capturing overlay with per-language
      rows (status glyph, file, duration, age), mirroring the
      `sf-skills-hud` pattern.
- [x] **Inline transcript row** — `pi.sendMessage({customType:"sf-lsp"})` +
      `registerMessageRenderer`. Balanced default (error + transition +
      first unavailable); verbose mode emits every check. User-only, never
      enters LLM context.

## ✅ Phase 3 — controls (shipped)

- [x] **Rich `/sf-lsp` panel** — `ctx.ui.custom` overlay with doctor
      status, recent activity ring, and `SelectList` actions (refresh
      doctor, toggle HUD, toggle verbose, shutdown servers).
- [x] **Subcommands** — `/sf-lsp hud [on|off|toggle]`,
      `/sf-lsp verbose [on|off|toggle]`, `/sf-lsp doctor`.
- [x] **Keyboard shortcut** — `Ctrl+Shift+L` toggles the HUD (mirrors
      `sf-devbar`'s `Ctrl+Shift+B`).
- [x] **`--no-sf-lsp-hud` CLI flag** for launching with the overlay
      suppressed (widget/footer/in-card still render).
- [x] **Persistent settings** — `hud` and `verbose` persist to
      `sfPi.sfLsp` in the global Pi settings file so choices survive
      restarts.

## 🔭 Phase 4 — deeper quick-fixes (planned)

- [ ] Expose Agent Script quick fixes (already present on
      `sfPiDiagnostics.diagnostics[n].fixes`) inside the in-card panel
      with a one-key "apply" chord, similar to VS Code's lightbulb.
- [ ] Keyboard shortcut `Ctrl+.` on a failing file to apply the
      preferred fix.

## 🔭 Phase 5 — workspace-wide view (planned)

- [ ] `/sf-lsp workspace` — fan out doctor + last-check summaries across
      every SF file that has been touched this session, rendered as a
      table inside the rich panel.
- [ ] Optional "lint all open files" action in the panel for batch
      validation before a deploy.

## 🔭 Phase 6 — observability hooks (planned)

- [ ] Append LSP event samples to the session as
      `pi.appendEntry("sf-lsp/event", …)` so `/tree` navigation and
      compaction can replay the HUD state.
- [ ] Offer an "export activity" action that dumps the ring buffer to a
      JSON file for offline analysis.

## Non-goals

- Replacing VS Code's full LSP experience. sf-lsp stays advisory.
- Changing the LLM-facing text appended by `feedback.ts`. That contract
  belongs to the write/edit self-correction loop and stays untouched.
- Owning `.agent` diagnostics when `sf-agentscript-assist` is loaded —
  the precedence rule from Phase 0 still applies.

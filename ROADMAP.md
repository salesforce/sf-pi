# Roadmap

This is the rough plan for what `sf-pi` wants to be, listed roughly by
priority. Nothing here is a promise. The project is maintained in spare
time.

If you want something on this list to move faster, file an issue with a
design proposal and — ideally — a PR.

## Shipped

- [x] Apache-2.0 release + non-affiliation disclaimers
- [x] Public CI (lint, typecheck, tests, coverage, SPDX, gitleaks, CodeQL)
- [x] Dependabot for npm + GitHub Actions
- [x] Governance, security, and contribution docs
- [x] release-please automation, including release-PR auto-merge hardening
- [x] Agent-friendly validation output in `scripts/validate.sh`
- [x] SPDX pre-commit / CI enforcement and LLM-artifact CI guard
- [x] In-process Agent Script authoring companion (`sf-agentscript-assist`)
      with vendored SDK, deterministic quick fixes, and weekly upstream sync
- [x] `slack_send` with human-in-the-loop confirm + audit trail
- [x] Scope probing + dynamic tool gating for `sf-slack`
- [x] Unified one-provider gateway design with OpenAI-compat + native
      Anthropic transport routing in `sf-llm-gateway-internal`
- [x] pi `>=0.72.0` runtime floor with per-model thinking/baseUrl support
- [x] Auto-generated catalog, command reference, troubleshooting index, and
      folder layout (drift-proof docs via `npm run generate-catalog`)
- [x] First-boot auto-install for Apex + LWC language servers
      (`/sf-lsp install`, async prompt on `session_start`, always-latest
      upstream tracking, Windows prints manual steps)
- [x] Announcements panel and update nudge in `sf-welcome` / `sf-pi-manager`
- [x] `/sf-pi skills` external skill-root wiring for Claude Code, Codex, and Cursor
- [x] Recommended external-extension bundle, including `pi-subagents`
- [x] Static public splash screenshot in the root README
- [x] Animated Pi + SALESFORCE splash wordmark with local preview scripts
- [x] GitHub aggregate metrics archival with no active runtime telemetry

## Now (0.x — pre-1.0)

- [ ] Animated GIF / short terminal capture of the TUI + splash
- [ ] Ratchet coverage floor toward 60%
- [ ] Clean up remaining ESLint warnings (unused vars, no-explicit-any)
- [ ] `NO_COLOR=1` support across splash, spinner, devbar
- [ ] `sf-skills-hud` Phase 2 (see
      [`extensions/sf-skills-hud/ROADMAP.md`](./extensions/sf-skills-hud/ROADMAP.md))

## Next

- [ ] Generic OpenAI-compatible gateway alternative to `sf-llm-gateway-internal`
      that works for external users
- [ ] Per-extension telemetry opt-in proposal, if ever needed, with explicit privacy review
- [ ] Docs site (Astro Starlight, deployed via GitHub Pages)
- [ ] Example fixtures and walkthroughs for each extension in `docs/`
- [ ] Stable plugin API for third-party community extensions

## Later (pre-1.0)

- [ ] First-class Windows (non-WSL) support
- [ ] Programmatic SDK so scripts can drive the extension manager
- [ ] Richer splash — dynamic tips from the catalog, keyboard shortcuts cheat sheet
- [ ] Internationalization scaffolding (even if only en-US ships)

## Graduation to 1.0

`1.0.0` requires:

- Public API stability commitment (no breaking changes without a major
  bump).
- 70%+ code coverage on `extensions/` and `lib/`.
- Two or more active maintainers in [`GOVERNANCE.md`](./GOVERNANCE.md).
- At least one external-user integration tested against a generic
  gateway.
- Published security policy with documented response SLAs that the
  maintainers have honored for at least 6 months.

## Non-goals

Just as important as the "what we'll do":

- `sf-pi` does **not** want to be an IDE. Pi is an agent runtime.
- `sf-pi` does **not** ship official Salesforce features. Anything
  Salesforce-specific must be documented as community-built.
- `sf-pi` does **not** collect active runtime telemetry. Aggregate GitHub
  metrics may be archived by GitHub Actions, but installed copies of sf-pi do
  not send usage events.
- `sf-pi` does **not** take PRs that introduce Salesforce-internal
  hostnames, keys, or other confidential endpoints into source.

---

Have an idea that isn't on this list? Open a
[Discussion](https://github.com/salesforce/sf-pi/discussions) and make your
case.

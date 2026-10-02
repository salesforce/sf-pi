# SF Brain

## What It Does

SF Brain adds two compact hidden context messages:

1. The immutable Salesforce Engineering Constitution from
   [`SF_CONSTITUTION.md`](./SF_CONSTITUTION.md).
2. A small SF Pi routing summary that prioritizes active SF Pi tools and lists
   only disabled capability owners with their `/sf-pi enable <id>` recovery path.

The constitution establishes Salesforce-first interpretation, source authority,
Behavior-Proof-First Development, minimal change, Guardrail authority, raw CLI
fallback rules, context discipline, and simple, visual chat communication
(answer first, small Mermaid diagrams, and a consistent emoji legend). Detailed
recipes remain progressively disclosed through extension operating guides.

The visual style applies to chat responses only and adapts to existing
settings. Pi `markdown.mermaid: "off"` switches to text flows, and
`sfPi.asciiIcons` / `SF_PI_ASCII_ICONS=1` (auto-on in macOS Terminal.app)
switches to text markers such as `[OK]` and `[WARN]`. Display capabilities live
in a separate hidden context message, so a settings change supersedes the old
state on the next turn without replacing the stable constitution.

Terminal Mermaid guidance prefers the most specific supported family, one
top-level fence, vertical flowcharts, short labels, and roughly 6–8 nodes.
Sequence diagrams should stay near four participants; ER and class diagrams
should stay near four boxes. Editable or durable Salesforce diagrams belong in
`tldraw_canvas`; Mermaid remains the compact chat overview.

When the selected model is `sf-llm-gateway/gpt-6-sol`, SF Brain adds a small,
model-scoped system prompt section asking for a developed explanation with an
example and relevant trade-offs on substantive questions. It keeps simple
answers short and honors explicit requests for brevity. Pi removes the section
when another model is selected; the persistent constitution is unchanged.
This guidance does not change reasoning effort or API text verbosity.

User guidance can extend—but never replace—the bundled constitution through
`<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`. Empty or unreadable files
are ignored; legacy replacement-style `SF_KERNEL.md` files are not loaded.
Bundled constitution updates take effect on the next turn after `/reload`;
addendum changes still require a new session.

## Diagnostics

**SF Pi Manager → SF Brain** exposes three read-only diagnostics:

- **Display capabilities** — effective Mermaid mode, icon mode, terminal, width,
  supported families, and the Mermaid-versus-tldraw boundary.
- **Instruction surface** — model-visible context size and public-safe
  contributors without displaying or persisting their content.
- **Visual response audit** — bounded aggregate-only counts for diagram
  families, widths, warnings, renderability, and icon usage across recent
  sessions for the current project.

```bash
npm run instruction-surface:report
npm run visual-response:report -- --max-sessions 50 --width 80
npm run e2e:instruction-behavior -- --model <model> --scenario visual-sequence
```

Artifacts default to `.pi/state/sf-brain/`. The visual audit never writes
transcript text, Mermaid labels, session ids, filenames, or workspace paths.
The opt-in behavior regression captures final output only long enough to check
its structural contract; reports contain facts rather than response content.

## Safety and Data Boundaries

- SF Brain registers no LLM tools and performs no Salesforce org operation.
- The bundled constitution is always preserved; user guidance is append-only.
- Instruction Surface reports expose counts and public-safe contributor ids,
  never prompt text, context files, skill descriptions, tool schemas,
  credentials, org details, session ids, or user-specific paths.
- Visual Response reports contain aggregate counters and width percentiles only;
  transcript text, Mermaid labels, filenames, session ids, and workspace paths
  never leave the bounded in-process scan.

## References

See [`docs/README.md`](./docs/README.md) for the upstream-ready Pi Mermaid
fallback proposal and its reusable public-safe fixture.

## Troubleshooting

**The constitution never appears in model context:** Confirm `sf-brain` is
enabled and start a new session if the current session contains a retired
`sf-brain-kernel` entry.

**User guidance does not take effect:** Use exactly
`<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`, then start a new session.
A live constitution entry remains stable for the current session by design.

**Mermaid or icon settings look stale:** Submit the next turn. SF Brain appends
new display-capability context only when the effective setting changes and keeps
only the latest value model-visible.

**A diagram remains source:** Open **Display capabilities**. Unsupported,
nested, warned, or over-width Mermaid remains a source fence in Pi today. Use a
supported top-level form, shorten it, or use tldraw for the detailed artifact.

**An Instruction Surface baseline is not comparable:** Compare only reports
with the same measurement schema and audited Pi Runtime version.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-brain/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
  SF_CONSTITUTION.md          ← bundled Salesforce Engineering Constitution
```

<!-- GENERATED:file-structure:end -->

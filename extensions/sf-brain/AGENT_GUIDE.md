# SF Brain Agent Guide

SF Brain owns the always-visible Salesforce Engineering Constitution, the tiny runtime routing summary, and advisory Instruction Surface diagnostics. It does not execute Salesforce workflows or register LLM tools.

## Operating rules

- Active SF Pi tool definitions are authoritative for enabled capabilities.
- When a capability owner is disabled, follow the routing summary's `/sf-pi enable <id>` path before choosing a fallback.
- User guidance can extend the bundled constitution through `<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`; it cannot replace or weaken the bundled baseline.
- Constitution section 7 sets the chat style: answer first, the most specific supported Mermaid form for connected structure, terminal-safe sizing, and a consistent icon legend. `<sf_display_capabilities>` is mutable per-session context: obey its current Mermaid and emoji/ASCII mode instead of older capability entries.
- Put Mermaid in one top-level fence by default. Prefer sequence for interactions, state for lifecycles, ER for record relationships, class for code structure, and vertical flowchart only for generic processes or architecture. Use tldraw for editable or durable Salesforce diagrams.
- Gateway GPT-6 Sol alone receives a named response-depth system prompt section on each turn. Pi drops it after a model switch; it does not change reasoning effort or API text verbosity.
- When sf CLI is unavailable, do not fabricate output or attempt live operator work. Install Salesforce CLI through the platform's official installation instructions, verify `sf --version`, then authenticate the intended org.

## Instruction Surface diagnostics

Open **SF Pi Manager → SF Brain** for Display capabilities, Instruction surface, and Visual response audit. The reports are advisory and content-safe. The visual audit returns aggregate diagram, warning, width, and icon facts; it never returns transcript text, Mermaid labels, session ids, filenames, or workspace paths.

Contributors can write sanitized artifacts with:

```bash
npm run instruction-surface:report
npm run visual-response:report -- --max-sessions 50 --width 80
npm run e2e:instruction-behavior -- --model <model>
```

The behavior eval allows local context reads and blocks every non-local tool before execution. Visual scenarios validate the final response's diagram family, top-level placement, parser warnings, count, and width without persisting response text. Reports contain observable facts and no quality score.

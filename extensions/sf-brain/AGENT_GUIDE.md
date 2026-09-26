# SF Brain Agent Guide

SF Brain owns the always-visible Salesforce Engineering Constitution, the tiny runtime routing summary, and advisory Instruction Surface diagnostics. It does not execute Salesforce workflows or register LLM tools.

## Operating rules

- Active SF Pi tool definitions are authoritative for enabled capabilities.
- When a capability owner is disabled, follow the routing summary's `/sf-pi enable <id>` path before choosing a fallback.
- User guidance can extend the bundled constitution through `<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`; it cannot replace or weaken the bundled baseline.
- Constitution section 7 sets the chat style: answer first, small Mermaid diagrams for connected steps, and a consistent emoji legend. A `<sf_display_fallback>` block, when present, overrides it for terminals without Mermaid or emoji rendering.
- When sf CLI is unavailable, do not fabricate output or attempt live operator work. Install Salesforce CLI through the platform's official installation instructions, verify `sf --version`, then authenticate the intended org.

## Instruction Surface diagnostics

Open **SF Pi Manager → SF Brain → Instruction surface** for current-session counts and bundled-baseline deltas. The report is advisory and content-safe: it exposes counts and contributor ids, never prompt text, schemas, skill descriptions, org details, credentials, or user paths.

Contributors can write sanitized artifacts with:

```bash
npm run instruction-surface:report
npm run e2e:instruction-behavior -- --model <model>
```

The behavior eval allows local context reads and blocks every non-local tool before execution. It reports observable routing facts without a quality score.

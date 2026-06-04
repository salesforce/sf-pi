# SF Agent Script Uses Official AgentScript Packages

SF Agent Script uses exact-versioned public `@sf-agentscript/*` npm packages as its Agent Script toolchain source instead of a vendored compiler bundle. This keeps parser, compiler, language-service, and LSP behavior aligned with the maintained AgentScript packages while SF Pi retains a thin hardening adapter for Salesforce/pi-specific diagnostics, quick fixes, rendering, and workflow guardrails.

## Consequences

- `@sf-agentscript/agentforce` is the primary parser/compiler/dialect source for local Agent Script authoring.
- `@sf-agentscript/language` and `@sf-agentscript/lsp` own generic AgentScript quick fixes and reference/definition semantics where SF Pi exposes those capabilities.
- SF Pi keeps Structural Agent Script Inspection because it is an agent-friendly projection, not a generic LSP feature.
- Package versions are pinned exactly so diagnostic and compile behavior change only through intentional dependency refreshes.

# SF Brain

## What It Does

SF Brain adds two compact hidden context messages:

1. The immutable Salesforce Engineering Constitution from
   [`SF_CONSTITUTION.md`](./SF_CONSTITUTION.md).
2. A small SF Pi routing summary that prioritizes active SF Pi tools and lists
   only disabled capability owners with their `/sf-pi enable <id>` recovery path.

The constitution establishes Salesforce-first interpretation, source authority,
Behavior-Proof-First Development, minimal change, Guardrail authority, raw CLI
fallback rules, and context discipline. Detailed recipes remain progressively
disclosed through extension operating guides.

User guidance can extend—but never replace—the bundled constitution through
`<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`. Empty or unreadable files
are ignored; legacy replacement-style `SF_KERNEL.md` files are not loaded.

## Instruction Surface diagnostics

**SF Pi Manager → SF Brain → Instruction surface** opens a read-only report of
model-visible context size. It separates SF Pi tool definitions, prompt
guidance, hidden context, bundled skills, and external Salesforce skills without
rendering or persisting their content.

```bash
npm run instruction-surface:report
npm run e2e:instruction-behavior -- --model <model> --scenario apex-behavior-fix
```

Artifacts default to `.pi/state/sf-brain/`. The opt-in behavior regression
allows bounded local reads and blocks every non-local tool before execution.

## Safety and Data Boundaries

- SF Brain registers no LLM tools and performs no Salesforce org operation.
- The bundled constitution is always preserved; user guidance is append-only.
- Instruction Surface reports expose counts and public-safe contributor ids,
  never prompt text, context files, skill descriptions, tool schemas,
  credentials, org details, session ids, or user-specific paths.

## Troubleshooting

**The constitution never appears in model context:** Confirm `sf-brain` is
enabled and start a new session if the current session contains a retired
`sf-brain-kernel` entry.

**User guidance does not take effect:** Use exactly
`<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`, then start a new session.
A live constitution entry remains stable for the current session by design.

**An Instruction Surface baseline is not comparable:** Compare only reports
with the same measurement schema and audited Pi Runtime version.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-brain/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
  SF_CONSTITUTION.md          ← bundled Salesforce Engineering Constitution
```

<!-- GENERATED:file-structure:end -->

# ADR 0008: Context-injection boundary tags use lowercase snake_case XML

## Status

Accepted

## Context

Five sf-pi extensions inject context blocks into the agent's session at
session start or per-turn:

| Extension                 | What it injects                                    |
| ------------------------- | -------------------------------------------------- |
| `sf-brain`                | Salesforce Operator Kernel (rule set)              |
| `sf-devbar`               | Salesforce environment (CLI / project / org / API) |
| `sf-slack`                | Slack workspace identity (user + team)             |
| `sf-guardrail`            | Guardrail policy summary                           |
| `sf-llm-gateway-internal` | Provider/gateway identity                          |

Each block is delivered through pi's `BeforeAgentStartEventResult.message`
path, persists as a `custom_message` session entry with `display: false`,
and is replayed on every turn so the model sees the same content
turn-after-turn (cache-friendly).

Until pi 0.75 we wrapped each block in a square-bracket Markdown-style
heading:

```
[Salesforce Operator Kernel]
…body…

[Salesforce Environment]
…body…
```

This worked, but had two latent problems:

1. **Bracket collisions.** A user prompt or pasted content that happened
   to include a literal `[Salesforce Environment]` line was
   indistinguishable from our injected block. The model had no syntactic
   way to know where our block ended and surrounding content began.
2. **Mixed convention with pi.** Pi 0.75 (#4541) moved its own internal
   boundaries (system prompt sections, context files, conversation
   serialization) from Markdown headings to explicit XML tags
   (`<conversation>`, `<project_context>`, `<project_instructions>`).
   Models parse XML opening/closing tags syntactically; they parse
   bracketed headings via prose-recognition heuristics. Pi telegraphed
   the direction even though their fix did not affect our blocks
   directly.

## Decision

All sf-pi context-injection blocks use lowercase snake_case XML tags,
matching pi's own boundary convention. Each block is wrapped in a
matched opening + closing pair around its body:

```
<sf_operator_kernel>
…body…
</sf_operator_kernel>

<sf_environment>
…body…
</sf_environment>

<slack_workspace>
…body…
</slack_workspace>

<sf_guardrail>
…body…
</sf_guardrail>
```

Cross-references between blocks use the bare opening tag as the anchor
(`see <sf_environment>` instead of `see [Salesforce Environment]`).

## Consequences

### Positive

- **Syntactic boundary recognition.** Pasted content that happens to
  include `<sf_environment>` is now visibly weird (unmatched, no
  closing tag) instead of indistinguishable from our injection.
- **Convention parity with pi.** New contributors and future agents
  reading the codebase don't have to learn two boundary styles.
- **Cleaner cross-references.** The bare opening tag (`<sf_environment>`)
  is readable inline in prose and matches the fenced block exactly.

### Negative / migration cost

- **User overrides break.** sf-brain and sf-guardrail honor user
  override files at `<globalAgentDir>/<extension>/SF_*.md`. Existing
  override files that start with the old bracket header will pass
  through verbatim — they still work but no longer match the convention.
  Documented in the per-extension READMEs.
- **One-pass migration touched 8 production files + 5 tests.** Worth it
  for the lockstep, but the diff is wide. Future contributors adding a
  new injection should follow this convention from day one.

### Neutral

- The model behaves the same way on both formats in practice. The win
  is mostly about _future_ robustness as model families evolve and
  about staying within pi's own convention so the surface stays small.

## Implementation notes

- Use `<sf_*>` for Salesforce-specific blocks, `<slack_*>` for Slack,
  `<provider>` (existing) or `<gateway>` for LLM provider identity.
- Tag bodies are plain text — no nested tags, no attributes. We are
  not encoding structured data; the tags are pure boundary markers.
- The opening tag is on its own line, body follows on the next line,
  closing tag is on its own line at the end. Match pi 0.75's
  `<conversation>` shape exactly.

## Future work

- If pi exposes a first-class "inject boundary-wrapped context" helper
  in the API, migrate to it. Until then, every injecting extension
  emits its own tags.
- A future ADR may revisit the choice of `BeforeAgentStartEventResult.message`
  vs `BeforeAgentStartEventResult.systemPrompt` for the kernel and the
  guardrail (which are static rules, not per-turn context). That is
  orthogonal to the boundary convention this ADR pins.

## References

- pi 0.75 changelog #4541 — "Fixed system prompt and context file
  boundaries to use explicit XML tags instead of Markdown headings,
  reducing inconsistent boundary ingestion by models."
- `lib/common/sf-environment/format-agent-context.ts` — `<sf_environment>`
- `extensions/sf-brain/SF_KERNEL.md` and `extensions/sf-brain/lib/kernel.ts`
  (`KERNEL_OPEN_TAG`, `KERNEL_CLOSE_TAG`) — `<sf_operator_kernel>`
- `extensions/sf-slack/index.ts` — `<slack_workspace>`
- `extensions/sf-guardrail/lib/guidance.ts` — `<sf_guardrail>`

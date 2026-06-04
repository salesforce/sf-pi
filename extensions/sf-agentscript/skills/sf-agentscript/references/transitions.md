# Transitions in Agent Script

Two shapes only. There is no guarded `when "..."` form. If you wrote
one, `agentscript_authoring compile/check` returns `[E] missing-token` on that line
and `agentscript_authoring mutate apply_quick_fix` will offer to strip the
`when` clause for you.

## Form 1 — deterministic transition (node-level)

Inside a `topic`, `subagent`, `start_agent`, or other node body:

```
topic greeting:
    description: "Greet the user."
    instructions: |
        | Say hello.
    transition to @topic.faq
```

**Fires** when the node completes. No condition, no LLM choice. The
FSM moves to `@topic.faq` every time. Good for sequencing
deterministic steps (e.g. `start_agent` always transitioning into a
greeting topic).

## Form 2 — LLM-discretionary transition (instruction-level)

Inside an `instructions:` block:

```
topic greeting:
    description: "Greet the user."
    instructions: |
        | Greet the user warmly.
        | When the user asks any question about Agentforce or this demo,
        | run @utils.transition to @topic.faq.
```

**Fires** when the LLM decides — i.e. when its model thinks the
condition the prose describes has been met. The condition lives in
plain English in the same instruction stream the model is reading.

## What you can NOT write

```
# Compile error: [E] missing-token
transition to @topic.faq when "the user asks a question"
```

Agent Script does not support a guarded transition syntax. The
`agentscript_authoring compile/check` `missing-token` diagnostic carries a quick
fix that strips the `when "..."` clause (turns it into Form 1). To
reach a topic only under specific conditions, use Form 2 inside the
`instructions:` block.

## Choosing between the two

| Use Form 1 (deterministic) when                  | Use Form 2 (LLM-discretionary) when       |
| ------------------------------------------------ | ----------------------------------------- |
| The flow is fixed (start → greeting → main loop) | The route depends on what the user said   |
| You want to bound the FSM's branching            | You want the model to make a routing call |
| Reproducibility matters (eval / regression)      | Conversational nuance matters more        |

When in doubt: prefer Form 1 + a router topic that uses Form 2 inline
to fan out. That's the hub-and-spoke pattern from the asset library.

## Reference

- Official SDK schema and diagnostic codes:
  `@sf-agentscript/agentforce`
- Quick-fix implementation: `extensions/sf-agentscript/lib/code-actions.ts`
  (case `missing-token`)
- Test coverage: `extensions/sf-agentscript/tests/code-actions.test.ts`

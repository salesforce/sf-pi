---
id: "0151"
status: accepted
date: 2026-10-22
supersedes: ["0150"]
---

# Pi 1.4.0 floor and native Gateway compaction

## Context

Dedicated Gateway compaction duplicated Pi's summary prompt, previous-summary
composition, output cap, and file-list formatting. Pi's exported `compact()`
already implements these responsibilities, including separate split-turn
summaries and combined usage.

A focused Behavior Proof passes on Pi 1.4.0 but fails on Pi 1.0.0 because the
older runtime drops custom instructions from the split-turn summary request.
Keeping the old floor would require accepting that regression or maintaining
local prompt patches alongside native compaction.

## Decision

Raise the **Pi Runtime Floor** to exact Pi 1.4.0. The hard loadable range is
stable `>=1.4.0 <2.0.0`; the **Pi Runtime Audit Edge** and recommended runtime
remain 1.4.0, with an audited ceiling of `<1.4.1`. Required compatibility CI
covers exact 1.4.0 and retains a non-blocking `latest` canary. The Node.js floor
remains 22.19.0. There is no older-runtime implementation or version branch.

Gateway compaction calls Pi's public `compact()` with its existing preparation
and an adapter through `ctx.modelRegistry.streamSimple()`. Pi owns prompt
construction, previous-summary composition, split-turn merging, usage
aggregation, and file-list formatting. Pi also supplies the request routing ID
and disables summary cache writes. SF Pi neither reads credentials nor changes
the active chat model.

SF Pi retains trusted scoped model preferences, availability checks, safe
warnings, cancellation, and native active-model fallback. The adapter checks the
actual generated prompt with Pi's token estimator before dispatch, reserving the
requested/model output budget plus the existing context safety margin. It
rejects blank or non-stop responses before Pi can merge split turns or add file
lists. Pi rejects attempted tool calls. Raw provider errors remain private.

## Consequences

- Users must upgrade Pi to at least 1.4.0; Doctor gives exact repair guidance.
- The copied summary format, fixed 8,192-token cap, and local file-formatting
  implementation are deleted. Summary wording and output budgeting follow Pi.
- Split turns can use two model requests rather than one; longer output can
  increase summary cost. No new setting or retry loop is introduced.
- Other Gateway transport behavior, setup UI, settings, and Slack dialog gating
  are unchanged.

## Behavior Proofs

- Dedicated-model and fallback checkpoints through Pi's real AgentSession and
  registered Gateway authentication/dispatch, preserving the active chat model.
- Split-turn custom instructions, previous summaries, usage aggregation, file
  context, invalid-summary rejection, cancellation, project trust, and
  pre-dispatch context-fit checks.
- Runtime-floor/Doctor policy, exact Pi 1.4.0 type checking and complete tests,
  clean-home loading, native MCP smoke, and generated/documentation validation.

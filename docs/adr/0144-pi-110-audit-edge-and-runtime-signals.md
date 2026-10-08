---
id: "0144"
status: accepted
date: 2026-10-08
supersedes: ["0140"]
---

# Pi 1.1.0 audit edge and runtime signals

## Context

Pi 1.1.0 adds additive `--tools` modifiers, terminal program-status reporting,
tool execution durations, configurable renderer output padding, aborted-run
state on `agent_settled`, image-capable classifier input, and provider, MCP,
and shutdown fixes. SF Pi already loads stable Pi `>=1.0.0 <2.0.0`, but its
required audit edge and recommended development runtime remained Pi 1.0.4.

Exact Pi 1.1.0 type checking, Manifest Runtime Surface Attestation, clean-home
startup, focused compatibility tests, the complete local suite, and the public
`latest` compatibility lane all pass. No Pi 1.1.0 extension API removal affects
SF Pi.

## Decision

SF Pi keeps stable Pi `1.0.0` as the **Pi Runtime Floor** and advances the
**Pi Runtime Audit Edge** and recommended development runtime to exact Pi
`1.1.0`. The required audited range becomes `>=1.0.0 <1.1.1`; stable releases
from `1.1.1` through the pre-2.0 hard ceiling continue to load in
forward-compatibility mode under ADR 0079.

Development dependencies and bounded repair guidance move to Pi 1.1.0. Required
compatibility evidence covers both the Pi 1.0.0 floor and Pi 1.1.0 edge, while
the non-blocking `latest` lane continues to report future drift. The floor does
not move because SF Pi does not require a Pi 1.1.0-only API.

SF Pi adopts two additive runtime signals without creating a second runtime
model:

1. The Agent-Settled Update Coordinator defers pending automatic work when
   `agent_settled` reports `aborted: true`; a later non-aborted settlement may
   run it. The property is read structurally so Pi 1.0.0 remains supported.
2. Code Analyzer's self-rendered result uses Pi's `outputPad` value. Shared card
   rendering accepts the resolved padding as ordinary input, so the code keeps
   compiling and rendering on the Pi 1.0.0 floor.

Pi owns OSC 7501 program status, MCP connection and OAuth cancellation,
provider retries, model catalog additions, classifier execution, and CLI tool
modifier parsing. SF Pi documents the native modifiers but adds no status
protocol, retry layer, classifier dependency, or tool-selection parser. Pi's
whole-tool duration remains available for future generic observability; SF
Browser, Data 360, Agent Script, Code Analyzer, and Gateway retain their more
specific phase, subprocess, API-call, and failure-diagnostic timings.

## Consequences

- Pi 1.1.0 users no longer receive SF Pi's forward-compatibility warning.
- Existing Pi 1.0.0 users remain supported without a parallel implementation.
- Cancelling a turn cannot immediately start a pending automatic update.
- Code Analyzer follows Pi's configured result padding while retaining its
  self-rendered foreground card.
- MCP, terminal status, provider recovery, and classifier enhancements arrive
  through Pi rather than duplicate SF Pi code.

## Behavior Proofs

- Exact Pi 1.0.0 and 1.1.0 type checking and full suites.
- Manifest Runtime Surface Attestation and clean-home loading with MCP disabled.
- Separate Pi-native MCP smoke coverage.
- Version-policy and Doctor tests for the floor, audit edge, and future stable
  releases.
- Agent-settled coordinator and real-extension tests proving aborted settlement
  deferral followed by execution at a non-aborted boundary.
- Code Analyzer renderer coverage proving `outputPad` changes the self-rendered
  result's horizontal padding.

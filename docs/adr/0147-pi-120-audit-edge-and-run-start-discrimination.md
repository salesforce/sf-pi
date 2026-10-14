---
id: "0147"
status: accepted
date: 2026-10-14
supersedes: ["0144"]
---

# Pi 1.2.0 audit edge and run-start discrimination

## Context

Pi 1.2.0 adds published configuration schemas, richer codemode declarations and
run timing, per-key OpenRouter catalogs, remote clipboard support, tool
reachability metadata, namespace aliases, and provider, MCP, resource-loading,
terminal, and compaction fixes. It also changes `before_agent_start` into a
union: user-started runs carry `prompt`, while custom-message-triggered runs
carry `message` and no prompt.

SF Pi already loads stable Pi `>=1.0.0 <2.0.0`, but its audit edge and exact
development dependencies remained Pi 1.1.0. Exact Pi 1.2.0 type checking found
one incompatible assumption: SF Skills read `event.prompt` directly when
counting explicit skill invocations. Runtime startup, the complete test suite,
Manifest Runtime Surface Attestation, and the bundled Salesforce theme otherwise
remained compatible.

## Decision

SF Pi keeps stable Pi `1.0.0` as the **Pi Runtime Floor** and advances the
**Pi Runtime Audit Edge** and recommended development runtime to exact Pi
`1.2.0`. The required audited range becomes `>=1.0.0 <1.2.1`; stable releases
from `1.2.1` through the pre-2.0 hard ceiling continue to load in
forward-compatibility mode under ADR 0079.

SF Skills distinguishes custom-message run starts before reading the optional
prompt. The event is read structurally so the same source remains compatible
with the Pi 1.0.0 event shape. Explicit user skill invocations continue to count;
custom-message-triggered runs do not.

The bundled `sf-dark` theme adopts Pi's published
`https://pi.dev/schemas/theme.schema.json` reference. SF Pi does not inject a
schema reference into user settings or create a second configuration validator.

Pi remains the owner of codemode declaration and timing behavior, per-key
OpenRouter catalogs, remote clipboard transport, provider recovery, MCP resource
and OAuth behavior, generic resource resolution, compaction serialization, and
tool reachability semantics. SF Pi adds no wrapper, retry layer, clipboard
adapter, model catalog, or MCP resource parser. The SF Skills resource-parity
work in ADR 0082 remains a separate design decision; the Pi 1.2 audit does not
change Funnel filter or rescope behavior.

## Consequences

- Pi 1.2.0 users no longer receive SF Pi's forward-compatibility warning.
- Existing Pi 1.0.0 users remain supported without a second implementation.
- SF Skills handles both user and custom `before_agent_start` variants without
  counting automatic custom-message runs as explicit skill use.
- Theme editors use Pi's stable published schema, while runtime theme validation
  remains Pi-owned.
- Pi 1.2 improvements arrive through the exact runtime dependency rather than
  duplicate SF Pi code.

## Behavior Proofs

- Exact Pi 1.0.0 and 1.2.0 type checking and complete suites.
- A real SF Skills factory proof covering Pi 1.0-style user starts, Pi 1.2 user
  starts, and Pi 1.2 custom-message starts.
- Manifest Runtime Surface Attestation and clean-home loading with MCP disabled.
- Explicit loading of the bundled `sf-dark` theme under Pi 1.2.0.
- Separate Pi-native MCP smoke coverage.
- Version-policy and Doctor tests for the floor, audit edge, and future stable
  releases.

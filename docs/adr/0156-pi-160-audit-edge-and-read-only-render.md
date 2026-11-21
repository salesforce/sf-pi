---
id: "0156"
status: accepted
date: 2026-11-21
supersedes: ["0155"]
---

# Pi 1.6.0 audit edge and read-only component render

## Context

Pi 1.6.0 changes one public extension type: a component's `render()` returns
`readonly string[]`, and `Container` returns the same cached array while its
children are unchanged. Extensions that change render output in place must
copy it first.

Against exact Pi 1.6.0, SF Pi's complete suite, clean-home loading, the native
MCP smoke, and runtime-surface attestation passed without code changes. Type
checking failed in three places that declared Pi render output as a mutable
`string[]`. No SF Pi code changes render output in place: every caller spreads,
slices, or maps it. The nightly `latest` canary reported the same three
places.

The rest of Pi 1.6.0 (new models, find-tool path patterns, `pi.exec` signal
exit codes, and fixes) needs no SF Pi change.

## Decision

Keep the **Pi Runtime Floor** at exact Pi 1.5.1. Raise the **Pi Runtime Audit
Edge** and recommended runtime to exact Pi 1.6.0. The hard loadable range stays
stable `>=1.5.1 <2.0.0`; the audited range becomes `>=1.5.1 <1.6.1`.
Development dependencies pin the coding-agent, AI, and TUI packages to 1.6.0.
Required nightly lanes cover exact Pi 1.5.1 and 1.6.0 with the non-blocking
`latest` canary. ADR 0155's adoptions and ADR 0079's forward-compatibility
behavior are unchanged.

Treat Pi component render output as read-only:

- Code that only reads render output accepts `readonly string[]`.
- Code that returns a Pi component's render output as its own copies it, so a
  caller can never change Pi's cached array.

Pi 1.6.0's AI package brings `@google/genai` 2.32.0, whose `preinstall`
script is the same no-op echo as the previously allowed 2.21.0. The
`allowScripts` entry moves to the new exact version.

## Consequences

- Users on Pi 1.5.1 or later keep loading SF Pi; Pi 1.6.0 is audited and no
  longer runs in forward-compatibility mode.
- SF Pi components stay correct when Pi reuses a cached render array.

## Behavior Proofs

- Exact Pi 1.5.1 and 1.6.0 type checking with no errors; the complete suite on
  Pi 1.6.0.
- Version-policy and Doctor proofs for the audit edge, exact pins, the
  unchanged floor, and forward compatibility above 1.6.0.
- Clean-home loading, the native MCP smoke, and runtime-surface attestation
  on Pi 1.6.0.
- Registry signatures verified for every installed package, and the
  lifecycle-script allowlist check.

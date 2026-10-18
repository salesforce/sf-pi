---
id: "0149"
status: accepted
date: 2026-10-18
supersedes: ["0147"]
---

# Pi 1.3.0 audit edge and native runtime fixes

## Context

Pi 1.3.0 restores active tools when resuming sessions, fixes ownership of stacked
custom overlays, bounds surviving codemode workers after cancellation, improves
provider recovery and cross-model thinking handling, rejects malformed final tool
arguments, and adds a native session-sharing destination preference. Its internal
Pi dependencies are pinned to exact release versions. The Node.js floor remains
22.19.0.

SF Pi already permits stable Pi `>=1.0.0 <2.0.0`, but its exact development pins,
required compatibility edge, and recommended runtime remained Pi 1.2.0.

## Decision

Keep Pi 1.0.0 as the **Pi Runtime Floor** and advance the **Pi Runtime Audit Edge**
and recommended runtime to exact Pi 1.3.0. Pin the coding-agent, AI, and TUI
development dependencies together. The audited range becomes `>=1.0.0 <1.3.1`;
newer stable pre-2.0 releases remain loadable in forward-compatibility mode under
ADR 0079. Required compatibility lanes cover exact Pi 1.0.0 and 1.3.0, with a
non-blocking `latest` canary.

This is a compatibility-only adoption. Pi continues to own tool restoration,
overlay completion, codemode execution, argument parsing, provider retries,
cross-model transcript conversion, sharing, and model catalogs. SF Pi adds no
wrapper, tool-exposure change, sharing default, or new Salesforce behavior.

Gateway-specific Responses image handling, terminal-close recovery, conservative
compatibility metadata, and the shared fixed-mask credential prompt remain.
Pi's Anthropic/Bedrock error-image fix does not replace Gateway Responses image
handling. Cache-preserving thinking changes require endpoint capability proof
before enabling new Gateway compatibility flags; they are outside this slice.

## Consequences

- Pi 1.3.0 is audited rather than producing a forward-compatibility warning.
- Pi 1.0.0 users retain support without a parallel implementation.
- Doctor repair advice uses exact Pi 1.3.0 while future stable releases remain
  warnings rather than incompatibility errors.
- Native runtime fixes arrive through Pi without increasing SF Pi code complexity.
- Behavioral feature pilots and release-specific regression additions remain
  separate work, rather than being bundled into a dependency audit.

## Behavior Proofs

- Exact Pi 1.0.0 and 1.3.0 type checking and complete test suites on Node 22.
- Version-policy and Doctor proofs for the unchanged floor, new edge, exact pins,
  prereleases, future stable releases, and blocked major versions.
- Manifest Runtime Surface Attestation and clean-home offline SF Pi loading.
- Separate Pi-native MCP smoke and explicit bundled `sf-dark` theme loading.
- Generated catalog, formatting, lint, documentation, and CI-like validation.

---
id: "0138"
status: accepted
date: 2026-10-05
supersedes: ["0136"]
---

# ADR 0138: Pi 1.0.3 audit edge

SF Pi keeps stable Pi `1.0.0` as the **Pi Runtime Floor** and advances the **Pi Runtime Audit Edge** and recommended development runtime to exact Pi `1.0.3`. The required audited range is `>=1.0.0 <1.0.4`; stable releases from `1.0.4` through the pre-2.0 hard ceiling continue to load in forward-compatibility mode under ADR 0079.

The floor does not move because SF Pi does not require a Pi 1.0.3-only extension interface. Development dependencies and bounded repair guidance move to 1.0.3, while required compatibility evidence covers both the 1.0.0 floor and the 1.0.3 edge. The non-blocking `latest` lane continues to report future drift.

Pi 1.0.3 renames its Azure provider from `azure-openai-responses` to `azure`. SF Pi has no references to the removed provider identity and adds no compatibility alias. Pi owns migration of user authentication, model, and settings configuration for that provider.

Other Pi 1.0.3 changes remain Pi-owned:

- Azure Foundry Chat Completions support and provider request shaping;
- codemode image output files and user-only output-file permissions;
- Home/End and fullscreen transcript keybindings;
- OAuth refresh-token persistence during cancellation;
- codemode resilience after an install is updated or removed; and
- dead-terminal error handling.

SF Pi adds no wrapper for those runtime concerns. It advances only package pins, runtime policy, current documentation, and compatibility evidence.

Behavior Proofs include exact Pi 1.0.0 and 1.0.3 type checking and full suites, Manifest Runtime Surface Attestation, clean-home loading, Pi-native MCP smoke coverage, version-policy tests for the floor and audited edge, and source review confirming that no removed Azure provider identity is used.

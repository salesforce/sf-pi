---
id: "0136"
status: accepted
date: 2026-10-04
supersedes: ["0134"]
---

# ADR 0136: Pi 1.0.2 audit edge and runtime delegation

SF Pi keeps Pi `1.0.0` as the **Pi Runtime Floor** and advances the **Pi Runtime Audit Edge** and recommended development runtime to exact Pi `1.0.2`. The required audited range is `>=1.0.0 <1.0.3`; stable releases from `1.0.3` through the pre-2.0 hard ceiling continue to load in forward-compatibility mode under ADR 0079.

The floor does not move because SF Pi does not need a Pi 1.0.1-only Interface. Development dependencies and normal repair guidance move to 1.0.2, while required compatibility evidence covers both the 1.0.0 floor and the 1.0.2 edge. The non-blocking `latest` lane continues to report future drift.

Pi 1.0.1 project MCP overrides are part of the supported configuration contract. A project entry containing only `enabled`, `exposure`, or `toolExposure` modifies the matching global server without copying its transport or credential configuration. SF MCP distinguishes these overrides from complete manual servers, preserves them during unrelated mutations, applies them when computing effective routing guidance, and hands their ordinary editing back to Pi's native `/mcp` surface. Pi's configuration loader and mutation helpers are not exported from the public package root, so SF MCP retains a small local Adapter rather than importing private `dist` paths.

Pi owns Pi Runtime installation, release checks, and update guidance across the managed installer, npm, and Nix. SF Welcome deletes its duplicate Pi latest-version fetch, npm release-age interpretation, runtime-release cache, update hint, and startup probe. It retains SF Pi package freshness because that information belongs to the SF Pi package lifecycle.

Other Pi 1.0.1 and 1.0.2 capabilities remain native:

- Pi's MCP Module owns Client ID Metadata Documents, OAuth URL copying, resumed-tool rendering, and project override persistence.
- Pi's tool renderer resolver is not used to relocate SF Pi's already-local tool rendering Implementation.
- Cloudflare classifier availability does not create an SF Pi routing dependency.
- Per-thinking-level sampling remains unused until neutral authenticated Gateway metadata requires it.
- Salesforce hosted MCP presets continue to use External Client App consumer keys; current Salesforce documentation does not replace that registration with Client ID Metadata Documents.
- Image, retry, provider, codemode-output, OAuth, and dependency-security fixes are inherited through the exact Pi family pins without SF Pi wrappers.

Behavior Proofs include exact Pi 1.0.0 and 1.0.2 type checking and full suites, Manifest Runtime Surface Attestation, clean-home loading, Pi-native MCP smoke coverage, project-override fixtures, SF Welcome rendering without a Pi Runtime freshness row, and version-policy tests for the floor, audited edge, forward-compatible range, and blocked major version.

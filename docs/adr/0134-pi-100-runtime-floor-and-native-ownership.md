---
id: "0134"
status: accepted
date: 2026-10-02
supersedes: ["0124"]
---

# ADR 0134: Pi 1.0 Runtime Floor and Native Ownership

SF Pi raises both the **Pi Runtime Floor** and **Pi Runtime Audit Edge** to exact
Pi `1.0.0`. Stable releases below `1.0.0`, prereleases, and Pi 2.x or later are
blocked with bounded repair guidance. Stable releases from `1.0.1` through the
pre-2.0 hard ceiling load in forward-compatibility mode under ADR 0079. The
exact required-CI audit range is therefore `>=1.0.0 <1.0.1`.

This remains a clean runtime cut rather than a dual-runtime compatibility
release. Development dependencies, repair guidance, package peer range,
required compatibility CI, documentation, and runtime gates move together. SF
Pi does not retain a Pi 0.99 path or add feature-detection branches for Pi
1.0-only APIs.

Pi continues to own generic runtime capabilities added or changed in 1.0:

- fullscreen and regular terminal modes, selection, rendering, and theme fixes;
- codemode declarations, script recovery guidance, and image-model execution;
- Radius and Anthropic login flows;
- MCP transport, OAuth credential identity, issuer validation, scope retention,
  metadata discovery overrides, resources, and deferred-tool restoration; and
- provider selection validation and transcript memory behavior.

SF Pi consumes these capabilities without wrapping them. SF tldraw remains the
owner of deterministic editable Salesforce diagrams; Pi image generation does
not replace it. SF MCP continues to author reviewed native configuration while
Pi owns OAuth and connection state. Tool-policy updates preserve Pi 1.0 OAuth
fields such as `authServerMetadataUrl` without interpreting them.

Pi 1.0 widens `quietStartup` from a boolean to `boolean | "header"`. SF Pi uses
`quietStartup: "header"` for Doctor's compact native startup repair. Pi's
setting controls only Pi's startup output. SF Welcome uses
`sfPi.welcome.mode="header" | "off"` as its separate source of truth and no
longer writes Pi's `quietStartup` setting. Automatic SF Welcome stays
non-blocking; the removed legacy startup-mode resolver and overlay setting are
not retained as compatibility paths.

Behavior Proofs include exact Pi 1.0 type checking, full tests, Manifest Runtime
Surface Attestation, clean-home package loading, Pi-native MCP smoke coverage,
version and repair-policy tests, SF Welcome setting ownership, and MCP OAuth
field preservation. Fullscreen and regular terminal modes receive a focused
manual review because the default changed even though the public component API
remains compatible.

---
id: "0140"
status: superseded
date: 2026-10-05
supersedes: ["0138"]
supersededBy: ["0144"]
---

# ADR 0140: Pi 1.0.4 audit edge and focused tool profiles

SF Pi keeps stable Pi `1.0.0` as the **Pi Runtime Floor** and advances the
**Pi Runtime Audit Edge** and recommended development runtime to exact Pi
`1.0.4`. The required audited range is `>=1.0.0 <1.0.5`; stable releases from
`1.0.5` through the pre-2.0 hard ceiling continue to load in
forward-compatibility mode under ADR 0079.

The floor does not move because SF Pi does not require a Pi 1.0.4-only extension
interface. Development dependencies and bounded repair guidance move to 1.0.4,
while required compatibility evidence covers both the 1.0.0 floor and the 1.0.4
edge. The non-blocking `latest` lane continues to report future drift.

Pi 1.0.4 adds `*` patterns to `--tools` and `--exclude-tools` and adds
`--no-mcp` for one-run MCP disablement. SF Pi documents focused direct-tool
profiles that use Pi's native selection, including non-MCP Browser, Agent
Script, and Data 360 sessions. SF Pi does not add a tool-selection UI, wildcard
parser, MCP-disable flag, second exposure model, or codemode-only pilot. The
1.0.4 and `latest` clean-home startup checks use `--no-mcp`. The Pi 1.0.0 floor
lane keeps an empty clean home
because that runtime predates the flag. Pi-native MCP availability remains a
separate explicit smoke so the contracts stay independently observable.

Other Pi 1.0.4 changes remain Pi-owned:

- codemode image reads and frozen script built-ins;
- prompt-guideline projection for declarations hidden by `prepareLoadout`;
- MCP native-client registration and orderly shutdown during connection;
- Bedrock retry behavior; and
- syntax highlighting.

SF Browser and SF tldraw retain their evidence, resizing, artifact, and
validation boundaries; generic codemode image reads do not replace them. SF MCP
continues to author reviewed native configuration while Pi owns MCP connection,
OAuth, exposure enforcement, and shutdown.

Behavior Proofs include exact Pi 1.0.0 and 1.0.4 type checking and full suites,
Manifest Runtime Surface Attestation, clean-home loading at the floor,
1.0.4 clean-home loading with MCP disabled, separate Pi-native MCP smoke
coverage, version-policy and Doctor tests for the floor and audited edge, and
source review confirming that SF Pi does not depend
on the prior `--tools` treatment of MCP tools.

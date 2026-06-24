# ADR 0056: Pi 0.79.9 runtime floor

Status: accepted

SF Pi will raise its minimum Pi Runtime to `0.79.9` because this release is the first baseline that includes the provider metadata fixes and session lifecycle fixes we want future code to rely on without compatibility shims. The first adoption slice updates the runtime gate and package metadata, removes the stale Mistral SDK override after dependency audit, and defers gateway model-behavior changes such as GLM, Fusion, or chat-template thinking to separately validated slices.

The selective-provider base-import note from this adoption slice is superseded by ADR 0066. SF Pi now prefers root package imports for neutral schema/type helpers and narrow provider API subpath imports for concrete provider stream transports.

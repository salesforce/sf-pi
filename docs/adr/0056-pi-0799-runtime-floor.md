# ADR 0056: Pi 0.79.9 runtime floor

Status: accepted

SF Pi will raise its minimum Pi Runtime to `0.79.9` because this release is the first baseline that includes the provider metadata fixes and session lifecycle fixes we want future code to rely on without compatibility shims. The first adoption slice updates the runtime gate and package metadata, removes the stale Mistral SDK override after dependency audit, and defers gateway model-behavior changes such as GLM, Fusion, or chat-template thinking to separately validated slices.

Selective `@earendil-works/pi-ai/base` imports remain deferred for SF Pi extension source until Pi's extension loader reliably resolves package subpath exports in the same runtime path used by installed packages. Until then, lightweight schema/type modules keep using the root `@earendil-works/pi-ai` import even though the runtime floor is `0.79.9`.

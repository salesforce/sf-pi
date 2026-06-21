# ADR 0056: Pi 0.79.9 runtime floor

Status: accepted

SF Pi will raise its minimum Pi Runtime to `0.79.9` because this release is the first baseline that includes the selective `@earendil-works/pi-ai/base` and `@earendil-works/pi-agent-core/base` entry points, the related provider metadata fixes, and session lifecycle fixes we want future code to rely on without compatibility shims. The first adoption slice is intentionally narrow: update the runtime gate and package metadata, move only lightweight helper/type imports to `@earendil-works/pi-ai/base`, add a guard against unnecessary root `pi-ai` imports, and defer gateway model-behavior changes such as GLM, Fusion, or chat-template thinking to separately validated slices.

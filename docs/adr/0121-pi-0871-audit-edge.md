---
id: "0121"
status: accepted
date: 2026-09-24
---

# ADR 0121: Pi 0.87.1 Audit Edge

SF Pi keeps its **Pi Runtime Floor** at exact Pi `0.87.0` and moves the **Pi
Runtime Audit Edge** to exact Pi `0.87.1`. Stable releases below `0.87.0`,
prereleases, and Pi 1.x or later remain blocked. Stable releases from `0.88.0`
through the pre-1.0 hard ceiling continue to load in forward-compatibility mode
under ADR 0079.

Pi 0.87.1 does not change the extension declaration surface used by SF Pi. The
published delta is a model-catalog update, a compaction-summary prompt fix, and
CLI `--mode` validation. SF Pi inherits those runtime fixes through the
development pin. It does not raise the floor, add a compatibility shim, or
adopt a new extension API.

Development dependencies, the repair recommendation, and required compatibility
CI move together. Required nightly jobs cover exact Pi `0.87.0` and exact Pi
`0.87.1`. The non-blocking `latest` canary remains. Repair guidance for a
blocked runtime selects `0.87.1`; users already on `0.87.0` stay loadable.

---
id: "0118"
status: superseded
date: "2026-09-21"
supersedes: ["0109"]
supersededBy: ["0119"]
---

# ADR 0118: Pi 0.86.0 Runtime Floor

SF Pi raises its **Pi Runtime Floor** from `0.84.0` to `0.86.0` and advances
its **Pi Runtime Audit Edge** to exact `0.86.1`. Stable runtimes below
`0.86.0`, prereleases, and Pi 1.x or later are blocked with bounded repair
guidance. Stable Pi releases from `0.87.0` through the pre-1.0 hard ceiling
continue to load in forward-compatibility mode under ADR 0079.

Pi 0.86 changes complete Provider stream inputs from the legacy `Context` shape
to transcript-backed `TranscriptContext`. SF LLM Gateway adopts that Interface
directly across its Anthropic Messages, OpenAI Chat Completions, and OpenAI
Responses adapters. Its exact-runtime compaction proof resolves the current
system prompt from transcript messages instead of reading the removed
`context.systemPrompt` field. SF Pi does not retain a dual context Adapter or a
pre-0.86 compatibility branch.

Pi 0.86 can evaluate shared source through isolated extension module graphs.
The forward-compatibility warning latch therefore lives on the process global
rather than in module-local state, preserving ADR 0079's one-warning contract
without centralizing extension registration.

The floor contract changes atomically across package metadata, lockfile,
runtime gates, Doctor and Welcome guidance, installation documentation, and
required exact-version CI. Exact Pi `0.86.0` proves the floor; exact Pi `0.86.1`
proves the audit edge; `latest` remains a non-blocking future canary.

SF Pi inherits Pi-owned prompt-cache warming, transcript-aware prompt and tool
updates, retry and compaction fixes, bug reporting, clipboard fixes, and startup
compile caching. This adoption adds no competing SF Pi Modules for those
capabilities. Gateway cache-lifetime metadata remains absent unless neutral,
authenticated discovery supplies it; model IDs alone never authorize an
inference.

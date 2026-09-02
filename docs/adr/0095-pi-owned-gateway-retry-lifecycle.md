---
id: "0095"
status: accepted
date: 2026-07-30
---

# ADR 0095: Pi-Owned Gateway Retry Lifecycle

With Pi 0.82 as the **Pi Runtime Floor**, Pi is the sole owner of SF LLM Gateway assistant retry policy, backoff, cancellation, and human-visible retry lifecycle. SF Pi deleted its Anthropic early-stream attempt loop, fixed sleeps, private retry event bus, listener wiring, and Gateway-specific retry default after the **Behavior Proof Ladder** passed. Pi's native agent-level `auto_retry_start` / `auto_retry_end` events provide workflow visibility, and Pi's provider retry settings govern lower-level request retries without an SF Pi override.

SF Pi retains only a small Gateway Adapter for sanitizing Messages error envelopes, preserving request IDs, and adding Gateway-specific terminal guidance when useful. Pi can retry a failed turn after partial output has become visible; one consistent native retry contract is preferred over competing nested retry layers. Exact Pi 0.84.0 and 0.84.4 integration tests cover early and partial failures, disabled retry, exhaustion, cancellation during backoff, attempt counts, and error normalization.

# ADR 0081: Complete Native Gateway Provider

Status: accepted

After Pi 0.81 compatibility and credential behavior are proven, SF LLM Gateway will replace its legacy `ProviderConfig` orchestration with one complete Pi `Provider`. The Provider owns Pi-native authentication, synchronous last-known models, provider-scoped refresh persistence, model filtering, and mixed API stream dispatch. Gateway-specific adapters retain URL normalization, route metadata, non-callable model filtering, payload and retry behavior, model-group drift, diagnostics, and spend reporting.

The migration lands as a direct replacement after behavior parity: SF Pi will not ship an intermediate legacy `refreshModels` migration or maintain old and new provider paths together. Parity must prove native login/logout, environment fallback, offline bootstrap, refresh success/failure retention, `models.json` overrides, all three transport families, compaction routing, bounded retries, no implicit thinking-level mutation, and no awaited startup network work before the custom cache, delayed timer, repeated registration, pseudo-auth marker, API-tag stripping, and ID dispatcher are deleted. This strengthens ADR 0001's one-provider decision.

## Pi 0.81.1 implementation decision

Gateway login uses Pi's public `ApiKeyAuth.login` orchestration and credential store without using Pi 0.81.1's visible stock secret prompt. Pi always presents the non-secret URL through a text prompt (Enter keeps the current value). SF Pi then mounts a session-bound, fixed-mask `ctx.ui.custom()` component for the API key and returns a canonical `ApiKeyCredential` containing the key plus default URL. Pi alone persists and removes it.

The complete Provider preserves real model API tags and uses Pi's API-map dispatch and provider-scoped `ModelsStore`. The static curated catalog remains as Pi's baseline while live/stored models form the dynamic overlay. Configured endpoints are materialized from request auth and never persisted in the model store. Valid discovered peers survive filtered non-callable sentinel IDs. Model-group enrichment failure does not replace the previous drift baseline.

Existing global and project config tokens are read-only compatibility inputs for the announced migration window. Setup and Claude Code import write no secrets. Explicit cleanup requires an active Pi-saved credential, successful authenticated doctor checks, and user confirmation; only the legacy `apiKey` field is removed.

# ADR 0081: Complete Native Gateway Provider

Status: accepted

After Pi 0.81 compatibility and credential behavior are proven, SF LLM Gateway will replace its legacy `ProviderConfig` orchestration with one complete Pi `Provider`. The Provider owns Pi-native authentication, synchronous last-known models, provider-scoped refresh persistence, model filtering, and mixed API stream dispatch. Gateway-specific adapters retain URL normalization, route metadata, non-callable model filtering, payload and retry behavior, model-group drift, diagnostics, and spend reporting.

The migration lands as a direct replacement after behavior parity: SF Pi will not ship an intermediate legacy `refreshModels` migration or maintain old and new provider paths together. Parity must prove native login/logout, environment fallback, offline bootstrap, refresh success/failure retention, `models.json` overrides, all three transport families, compaction routing, bounded retries, no implicit thinking-level mutation, and no awaited startup network work before the custom cache, delayed timer, repeated registration, pseudo-auth marker, API-tag stripping, and ID dispatcher are deleted. This strengthens ADR 0001's one-provider decision.

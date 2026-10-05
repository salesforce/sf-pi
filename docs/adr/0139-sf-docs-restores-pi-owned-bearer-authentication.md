---
id: "0139"
status: accepted
date: 2026-10-05
supersedes: ["0111"]
---

# ADR 0139: SF Docs Restores Pi-Owned Bearer Authentication

SF Docs requires a bearer token for its remote MCP-over-HTTP service. Interactive `/login sf-docs` collects the internally supplied endpoint URL, then uses SF Pi's shared fixed-mask credential input for the token. Pi alone persists the resulting API-key credential under provider id `sf-docs`, with the endpoint in `credential.env.SF_DOCS_MCP_ENDPOINT`; `/logout sf-docs` owns removal. The extension sends the resolved token only as the `Authorization: Bearer` request header.

`SF_DOCS_MCP_TOKEN` and `SF_DOCS_MCP_ENDPOINT` remain non-persisted automation fallbacks. SF Docs still ships with no default endpoint or token, performs no startup network request, and keeps both values out of model-visible output, errors, caches, settings, source, tests, and public examples. Endpoint-only credentials created under ADR 0111 remain readable for their non-secret URL but are incomplete until the user logs in with a token.

This supersedes ADR 0111 because the backing service no longer accepts unauthenticated requests. It restores the credential boundary from ADR 0060 while retaining ADR 0110's no-default-endpoint rule, ADR 0078's Pi-native credential ownership, and all protocol, evidence, retry, and grounding behavior added after authentication was removed.

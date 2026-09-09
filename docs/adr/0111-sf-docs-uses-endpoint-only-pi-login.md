---
id: "0111"
status: accepted
date: 2026-09-09
supersedes: ["0060"]
---

# ADR 0111: SF Docs Uses Endpoint-Only Pi Login

SF Docs keeps Pi-native `/login sf-docs` and `/logout sf-docs`, but login now collects and persists only an internally supplied documentation endpoint URL as `credential.env.SF_DOCS_MCP_ENDPOINT`. The backing service is unauthenticated, so SF Docs does not request, store, resolve, or transmit an access token and does not send an `Authorization` header.

The endpoint remains absent from the public bundle and public examples. `SF_DOCS_MCP_ENDPOINT` remains the automation fallback, and model-visible status reports only whether the endpoint is configured and where the configuration came from. Existing API-key-shaped entries can supply their saved endpoint during migration, but any legacy key is ignored.

This supersedes ADR 0060's token-storage decision and updates ADR 0110's login shape while retaining its no-default-endpoint boundary. Pi's provider auth model permits keyless `ApiKeyCredential` entries with provider-scoped `env` configuration, so no placeholder credential or second configuration store is required.

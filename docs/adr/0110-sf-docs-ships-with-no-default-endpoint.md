---
id: "0110"
status: accepted
date: 2026-09-08
---

# ADR 0110: SF Docs ships with no default endpoint

SF Docs no longer ships a bundled docs-service hostname. Interactive `/login sf-docs` collects a compatible endpoint URL, then a masked token. Pi persists both on the `sf-docs` credential (`env.SF_DOCS_MCP_ENDPOINT` plus the token). `SF_DOCS_MCP_ENDPOINT` and `SF_DOCS_MCP_TOKEN` remain automation fallbacks. Public docs, tests, and examples use generic fixtures only.

The DevBar shows a cache-first Docs pill from local token and endpoint resolution: hidden when nothing is configured, `! setup` when configuration is partial or invalid, and `✓` when both resolve. Session start does not call the docs service.

This complements [ADR 0060](./0060-sf-docs-uses-pi-auth-store.md) and [ADR 0078](./0078-pi-native-credential-ownership.md). It follows the public Gateway client rule from [ADR 0100](./0100-public-gateway-client-excludes-deployment-routing.md): SF Pi must not be a discovery path for an unpublished service hostname.

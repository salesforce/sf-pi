# SF Docs wraps MCP-over-HTTP directly instead of embedding an MCP runtime

SF Docs calls the Salesforce documentation service through a small internal HTTP JSON-RPC/SSE transport rather than installing an MCP client package, launching a local MCP server, or exposing MCP concepts as the extension's product surface. The remote protocol is treated as an implementation detail behind SF Pi-native commands, settings, docs, and the `sf_docs` LLM tool so the extension stays simple while preserving a clear replacement seam if the backing service changes later.

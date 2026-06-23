# SF Docs adds no MCP or SSE runtime dependencies

SF Docs uses native HTTP fetch plus a small local SSE data-line parser instead of adding MCP SDK, EventSource, JSON-RPC, scraping, search-index, or markdown parsing dependencies. The docs-service protocol surface used by SF Docs is narrow enough to implement directly, and avoiding new dependencies keeps startup, review, public-repo safety, and maintenance costs low.

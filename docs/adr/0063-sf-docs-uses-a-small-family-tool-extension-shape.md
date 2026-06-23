# SF Docs uses a small family-tool extension shape

SF Docs is implemented as a Bundled Extension with one `sf_docs` family tool, one `/sf-docs` command surface, a Manager settings panel, an extension-owned cheatsheet, and small files split by runtime responsibility: auth, transport, SSE parsing, catalog cache, preferences, rendering, status, and wiring. The split is intentionally narrow enough for agents to navigate safely while avoiding a generic backend abstraction, MCP runtime dependency, or cached documentation corpus.

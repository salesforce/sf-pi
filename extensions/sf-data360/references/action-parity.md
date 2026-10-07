# SF Data 360 Action Parity

This generated report compares the official public Data 360 operation snapshot with the single `sf_data360` business action catalog.

- Snapshot: https://github.com/forcedotcom/d360-mcp-server/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java
- Commit: c02edabceb024b9abef5f123943d5b09eafa6e72
- Upstream operations: 246
- Supported: 246
- Missing: 0
- SF Data 360 actions: 309
- Exact endpoint shapes: 241
- Adjusted endpoint shapes: 5
- Payload examples: 89 (0 missing)

## Missing operations

None.

## Contract

Every known upstream operation maps to one `sf_data360` action. Additional actions provide discovery, direct Query API V3, tenant ingestion, local helpers, observability, and orchestration. Runtime MCP or Java fallback is not used.

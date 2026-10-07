# SF Data 360 Safety

The single `sf_data360` tool classifies each action and endpoint as `read`, `safe_post`, `confirmed`, or `destructive`.

- Read and recognized safe query/search/validate/test POSTs run directly.
- Mutations require a reviewed `dry_run` and `allow_mutation: true`.
- Destructive actions additionally require a verified non-production target and Guardrail-mediated human approval.
- The intent flag never approves its own operation.
- Production and unresolved destructive targets fail closed.
- Headless destructive execution is limited to exact sweep-owned cleanup fixtures.
- `api.request` derives the host from the authenticated target and rejects arbitrary hosts.
- Query V3 and Ingestion tenant tokens stay in memory, are expiry-bounded, and never appear in output or artifacts.

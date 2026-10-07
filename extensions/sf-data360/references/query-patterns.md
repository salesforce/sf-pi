# SF Data 360 Query Patterns

`sf_data360` prefers Data 360 Query API V3 for `query.sql.*` actions. If the authenticated org token cannot be exchanged for a Query V3 tenant token, the action falls back to the equivalent Connect API endpoint and returns explicit transport evidence and a warning. Pass `transport: "query_v3"` for strict V3-only execution or `transport: "connect"` for an explicit Connect request.

## Preferred sequence

1. Discover objects and fields with `harmonize.dmo.list/get` or `prepare.dlo.list/get`.
2. Use `query.sql.run` with `queryRowLimit` or an explicit SQL `LIMIT`.
3. When the response is asynchronous, use `query.sql.status`.
4. Inspect schema with `query.sql.metadata` before broad row retrieval.
5. Page with `query.sql.rows` using bounded offset/limit or byte limits.
6. Cancel abandoned work with `query.sql.cancel`.

## Submit

```json
{
  "action": "query.sql.run",
  "params": {
    "sql": "SELECT COUNT(*) AS total FROM Example__dlm",
    "transferMode": "ADAPTIVE",
    "queryRowLimit": 10
  }
}
```

V3 supports `ADAPTIVE` and `ASYNC` transfer modes, parameter styles, typed parameters, query settings, row limits, and bounded result ranges. JSON is the default response format. Apache Arrow remains an opt-in future adapter when a workflow needs binary columnar results.

The older Direct Query API V1/V2 contracts are not part of the runtime. Exact Connect REST query endpoints remain reachable through named endpoint actions or `api.request` when explicitly required.

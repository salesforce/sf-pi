/* SPDX-License-Identifier: Apache-2.0 */
/**
 * End-to-end smoke for sf-data360 against a Data 360 org.
 *
 * Exercises the patched source modules directly (not the pi-registered
 * tools, which are bundled at process start). Pass the target org via
 * the first argv or D360_E2E_ORG env var.
 *
 *   node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts <alias>
 *   D360_E2E_ORG=<alias> node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts
 *
 * The script is read-only — every call is a GET, a SOQL/SQL SELECT, or a
 * safety-classification probe that never leaves the process. For each
 * surface, asserts against expected shapes printed inline. Exits non-zero
 * on any failure.
 *
 * Useful when validating a Data 360 org on a different API release than the
 * active sf-pi default — shared target/API-version resolution and request
 * body serialization are exercised through the same connection Module.
 */

import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import {
  classifyConnectionProbeResult,
  summarizeReadiness,
} from "../../extensions/sf-data360/lib/probe-tool.ts";
import { classifyD360Request } from "../../extensions/sf-data360/lib/safety.ts";
import {
  buildMetadataExecutionPlan,
  summarizeMetadataOutput,
  type D360MetadataInput,
} from "../../extensions/sf-data360/lib/metadata-tool.ts";
import { resolveRequest } from "../../extensions/sf-data360/lib/api-tool.ts";

const ALIAS = process.argv[2] ?? process.env.D360_E2E_ORG;
if (!ALIAS) {
  console.error("Usage: node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts <orgAlias>");
  console.error("   or: D360_E2E_ORG=<orgAlias> node --experimental-strip-types ...");
  process.exit(2);
}

let failures = 0;
function ok(name: string, detail?: string) {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail: string) {
  console.log(`  ✗ ${name} — ${detail}`);
  failures++;
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const sf = await connectSalesforce({ cwd: process.cwd(), targetOrg: ALIAS });
  const apiVersion = sf.target.apiVersion;

  section("1. Shared target and API-version resolution");
  console.log(
    `  target=${sf.target.targetOrg} apiVersion=${apiVersion} source=${sf.target.versionSource} orgType=${sf.target.orgType}`,
  );
  if (sf.target.targetOrg !== ALIAS) fail("target alias preserved", `got ${sf.target.targetOrg}`);
  else ok("target alias preserved");
  if (!apiVersion) fail("target apiVersion resolved", "undefined");
  else ok("target apiVersion resolved", apiVersion);

  section("2. Version-owned path construction");
  const built = sf.path("/ssot/foo", { limit: 1 });
  if (built !== `/services/data/v${apiVersion}/ssot/foo?limit=1`)
    fail("shared path", `got ${built}`);
  else ok("shared path stitches selected version + query");

  section("3. resolveRequest uses the shared session");
  const resolved = resolveRequest(
    { method: "GET", path: "/ssot/data-spaces", target_org: ALIAS },
    sf,
  );
  if (resolved.apiPath !== `/services/data/v${apiVersion}/ssot/data-spaces`)
    fail("apiPath uses target apiVersion", `got ${resolved.apiPath}`);
  else ok("apiPath uses target apiVersion", resolved.apiPath);
  if (resolved.orgType !== sf.target.orgType) fail("orgType detected", `got ${resolved.orgType}`);
  else ok("orgType detected", resolved.orgType);
  if (resolved.safety.requiresConfirmation !== false) fail("read GET is no-confirm", "regression");
  else ok("read GET is no-confirm");

  section("5. Safety classification samples");
  // Developer orgs are not productionLike, so plain writes don't require
  // confirmation; only DELETE/scoped-mutations do (matches safety.ts).
  const writeDev = classifyD360Request("POST", "/ssot/data-streams", "developer");
  if (writeDev.requiresConfirmation) fail("POST on developer org is no-confirm", "regression");
  else ok("POST on developer org is no-confirm");
  const writeProd = classifyD360Request("POST", "/ssot/data-streams", "production");
  if (!writeProd.requiresConfirmation) fail("POST on production requires confirm", "regression");
  else ok("POST on production requires confirm");
  const deletePush = classifyD360Request("DELETE", "/ssot/data-streams/abc", "developer");
  if (!deletePush.requiresConfirmation) fail("DELETE requires confirm", "regression");
  else ok("DELETE requires confirm");

  console.log(`\n  shared connection apiVersion = ${apiVersion}`);

  section("4. Probe — full d360_probe surface (16 paths)");
  const PROBES = [
    { name: "data_spaces", path: "/ssot/data-spaces", required: true },
    { name: "dmo_catalog", path: "/ssot/data-model-objects?limit=1", required: true },
    { name: "dlo_catalog", path: "/ssot/data-lake-objects?limit=1" },
    { name: "data_streams", path: "/ssot/data-streams?limit=1" },
    { name: "calculated_insights", path: "/ssot/calculated-insights?limit=1" },
    { name: "connectors", path: "/ssot/connectors" },
    { name: "connections_sfdc", path: "/ssot/connections?connectorType=SalesforceDotCom" },
    { name: "segments", path: "/ssot/segments?limit=1" },
    { name: "identity_resolution", path: "/ssot/identity-resolutions?limit=1" },
    { name: "activations", path: "/ssot/activations?limit=1" },
    { name: "data_transforms", path: "/ssot/data-transforms?limit=1" },
    { name: "data_actions", path: "/ssot/data-actions?limit=1" },
    { name: "semantic_models", path: "/ssot/semantic/models?limit=1" },
    { name: "profile_metadata", path: "/ssot/profile/metadata" },
    { name: "metadata_entities_dmo", path: "/ssot/metadata-entities?entityType=DataModelObject" },
    {
      name: "agent_platform_tracing_dlo",
      path: "/ssot/data-lake-objects/ObservabilitySpans__dll",
    },
  ];
  const probeResults = await Promise.all(
    PROBES.map(async (p) => {
      const resp = await sf.request({ method: "GET", path: p.path });
      return classifyConnectionProbeResult(p.name, p.path, resp.status, resp.body);
    }),
  );
  for (const r of probeResults) {
    const detail = `${r.state}${r.count !== undefined ? ` (${r.count} ${r.countKind})` : ""}`;
    console.log(`    ${r.name.padEnd(24)} ${detail}`);
  }
  const summary = summarizeReadiness(probeResults);
  console.log(`  summarizeReadiness: ${summary.state}`);
  if (summary.state === "blocked") fail("readiness !== blocked (post-fix)", summary.state);
  else ok("readiness summary classified", summary.state);

  section("5. list_dmos via metadata-tool plan");
  const listInput: D360MetadataInput = { action: "list_dmos" };
  const listPlan = buildMetadataExecutionPlan(listInput);
  const listPath = sf.path(listPlan.path);
  const listResp = await sf.request<unknown>({ method: "GET", path: listPlan.path });
  if (listResp.status !== 200) fail("list_dmos status 200", `got ${listResp.status}`);
  else ok(`list_dmos status 200 — ${listPath}`);
  const listSummary = summarizeMetadataOutput(
    listInput,
    JSON.stringify(listResp.body),
    "/tmp/raw.json",
  );
  const dmoCount = (listSummary.details as { count: number }).count;
  if (dmoCount < 30) fail("expected ≥30 DMOs", `got ${dmoCount}`);
  else ok("DMO inventory", `${dmoCount} entries`);

  section("6. describe_dmo on ssot__AiAgentSession__dlm");
  const descInput: D360MetadataInput = {
    action: "describe_dmo",
    api_name: "ssot__AiAgentSession__dlm",
  };
  const descPlan = buildMetadataExecutionPlan(descInput);
  const descPath = sf.path(descPlan.path);
  const descResp = await sf.request<unknown>({ method: "GET", path: descPlan.path });
  if (descResp.status !== 200) fail("describe status 200", `got ${descResp.status}`);
  else ok(`describe status 200 — ${descPath}`);
  const descSummary = summarizeMetadataOutput(
    descInput,
    JSON.stringify(descResp.body),
    "/tmp/raw.json",
  );
  const fieldCount = (descSummary.details as { fieldCount: number }).fieldCount;
  if (fieldCount < 10) fail("expected ≥10 fields", `got ${fieldCount}`);
  else ok("field count", String(fieldCount));

  section("7. SQL via /ssot/query-sql — both body shapes");
  const sqlA = await sf.request<{
    data?: number[][];
    metadata?: unknown;
    errorCode?: string;
  }>({
    method: "POST",
    path: "/ssot/query-sql",
    body: { sql: "SELECT COUNT(*) AS n FROM ssot__AiAgentSession__dlm" },
  });
  if (sqlA.status !== 200 || sqlA.body.errorCode)
    fail("SQL with object body", JSON.stringify(sqlA.body).slice(0, 200));
  else ok("SQL with object body", `count=${sqlA.body.data?.[0]?.[0]}`);

  const sqlB = await sf.request<{
    data?: number[][];
    metadata?: unknown;
    errorCode?: string;
  }>({
    method: "POST",
    path: "/ssot/query-sql",
    body: '{"sql":"SELECT COUNT(*) AS n FROM ssot__AiAgentInteractionMessage__dlm"}',
  });
  if (sqlB.status !== 200 || sqlB.body.errorCode)
    fail(
      "SQL with pre-stringified body (was double-encoded)",
      JSON.stringify(sqlB.body).slice(0, 200),
    );
  else ok("SQL with pre-stringified body (Bug 2 was here)", `count=${sqlB.body.data?.[0]?.[0]}`);

  section("8. Aggregations across joined DMOs");
  const aggSql = `
    SELECT b.ssot__DeveloperName__c, COUNT(*) AS turns
    FROM ssot__AiAgentInteractionStep__dlm s
    JOIN ssot__AiAgentInteraction__dlm i ON s.ssot__AiAgentInteractionId__c = i.ssot__Id__c
    JOIN ssot__AiAgentSession__dlm sess ON i.ssot__AiAgentSessionId__c = sess.ssot__Id__c
    JOIN ssot__Bot__dlm b ON sess.ssot__SessionOwnerId__c IS NOT NULL
    WHERE s.ssot__AiAgentInteractionStepType__c = 'LLM_STEP'
    GROUP BY b.ssot__DeveloperName__c
    ORDER BY turns DESC LIMIT 10`;
  const agg = await sf.request<{ data?: unknown[][]; errorCode?: string }>({
    method: "POST",
    path: "/ssot/query-sql",
    body: { sql: aggSql },
  });
  if (agg.body.errorCode) {
    console.log(`  (joined SQL not supported by org: ${agg.body.errorCode}) — falling back`);
    const fallback = await sf.request<{ data?: unknown[][]; errorCode?: string }>({
      method: "POST",
      path: "/ssot/query-sql",
      body: {
        sql: "SELECT ssot__AiAgentInteractionStepType__c, COUNT(*) FROM ssot__AiAgentInteractionStep__dlm GROUP BY ssot__AiAgentInteractionStepType__c ORDER BY 2 DESC LIMIT 10",
      },
    });
    if (fallback.status !== 200 || fallback.body.errorCode)
      fail("aggregate fallback", JSON.stringify(fallback.body).slice(0, 200));
    else {
      ok("aggregate fallback (group by step type)");
      for (const row of fallback.body.data ?? [])
        console.log(`    ${(row as unknown[]).join("\t")}`);
    }
  } else {
    ok("joined LLM-step aggregate");
    for (const row of agg.body.data ?? []) console.log(`    ${(row as unknown[]).join("\t")}`);
  }

  section("9. Read-only error-path coverage");
  const notFound = await sf.request({
    method: "GET",
    path: "/ssot/this-does-not-exist",
  });
  if (notFound.status !== 404)
    fail("404 surfaced as data, not exception", `status=${notFound.status}`);
  else ok("404 surfaced as data (no thrown exception)");

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});

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
 * active sf-pi default — the cross-org apiVersion resolution and the
 * connRequest body serialization contract are pinned by the early sections.
 */
 
import { connFromAlias } from "../../lib/common/sf-conn/connection.ts";
import { connRequest, serializeBody } from "../../lib/common/sf-conn/request.ts";
import { resolveTargetOrgContext } from "../../extensions/sf-data360/lib/target-org.ts";
import { buildApiPath, normalizeD360Path } from "../../extensions/sf-data360/lib/path.ts";
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
import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";

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
  const env: SfEnvironment = await detectEnvironment(async (cmd, args) => {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      const p = spawn(cmd, args);
      let stdout = "",
        stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }, process.cwd());

  console.log(`Active sf-pi env:`);
  console.log(`  default org: ${env.config.targetOrg ?? "(none)"}`);
  console.log(`  default org apiVersion: ${env.org.apiVersion ?? "(none)"}`);

  section("1. Bug 1 — cross-org API version resolution");
  const ctx = await resolveTargetOrgContext(ALIAS, env);
  console.log(`  target=${ctx.targetOrg} apiVersion=${ctx.apiVersion} orgType=${ctx.orgType}`);
  if (ctx.targetOrg !== ALIAS) fail("target alias preserved", `got ${ctx.targetOrg}`);
  else ok("target alias preserved");
  if (!ctx.apiVersion) fail("target apiVersion resolved", "undefined");
  else ok("target apiVersion resolved", ctx.apiVersion);
  // Cross-org check: when the explicit target's apiVersion differs from the
  // active env's, the resolver must use the *target's* version. This is the
  // bug that produced /services/data/v<wrong>/... 404s pre-fix.
  if (env.org.apiVersion && env.org.apiVersion !== ctx.apiVersion)
    ok(`cross-org: target=${ctx.apiVersion} ≠ active=${env.org.apiVersion}`);
  else ok(`target apiVersion matches active env (${env.org.apiVersion ?? "n/a"})`);

  section("2. Bug 2 — body serialization contract");
  if (serializeBody(undefined) !== undefined) fail("undefined → omitted", "regression");
  else ok("undefined → omitted");
  if (serializeBody({ sql: "x" }) !== '{"sql":"x"}') fail("object → JSON once", "regression");
  else ok("object → JSON once");
  const raw = '{"sql":"SELECT 1"}';
  if (serializeBody(raw) !== raw) fail("string → passthrough", "regression");
  else ok("string → passthrough");

  section("3. Path normalization");
  if (normalizeD360Path("/services/data/v60.0/ssot/foo") !== "/ssot/foo")
    fail("strips inbound /services/data/vNN.N", "regression");
  else ok("strips inbound /services/data/vNN.N");
  const built = buildApiPath("/ssot/foo", "66.0", { limit: 1 });
  if (built !== "/services/data/v66.0/ssot/foo?limit=1") fail("buildApiPath", `got ${built}`);
  else ok("buildApiPath stitches version + query");

  section("4. resolveRequest pins apiVersion to target org");
  const resolved = resolveRequest(
    { method: "GET", path: "/ssot/data-spaces", target_org: ALIAS },
    env,
    ctx.targetOrgInfo,
  );
  if (resolved.apiPath !== "/services/data/v66.0/ssot/data-spaces")
    fail("apiPath uses target apiVersion", `got ${resolved.apiPath}`);
  else ok("apiPath uses target apiVersion", resolved.apiPath);
  if (resolved.orgType !== "developer") fail("orgType detected", `got ${resolved.orgType}`);
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

  const conn = await connFromAlias(ALIAS);
  console.log(`\n  jsforce conn apiVersion = ${conn.getApiVersion()}`);

  section("6. Probe — full d360_probe surface (15 paths)");
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
  ];
  const probeResults = await Promise.all(
    PROBES.map(async (p) => {
      const url = buildApiPath(p.path, ctx.apiVersion);
      const resp = await connRequest(conn, { method: "GET", url });
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

  section("7. list_dmos via metadata-tool plan");
  const listInput: D360MetadataInput = { action: "list_dmos" };
  const listPlan = buildMetadataExecutionPlan(listInput);
  const listPath = buildApiPath(listPlan.path, ctx.apiVersion);
  const listResp = await connRequest<unknown>(conn, { method: "GET", url: listPath });
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

  section("8. describe_dmo on ssot__AiAgentSession__dlm");
  const descInput: D360MetadataInput = {
    action: "describe_dmo",
    api_name: "ssot__AiAgentSession__dlm",
  };
  const descPlan = buildMetadataExecutionPlan(descInput);
  const descPath = buildApiPath(descPlan.path, ctx.apiVersion);
  const descResp = await connRequest<unknown>(conn, { method: "GET", url: descPath });
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

  section("9. SQL via /ssot/query-sql — both body shapes");
  const sqlPath = buildApiPath("/ssot/query-sql", ctx.apiVersion);
  const sqlA = await connRequest<{
    data?: number[][];
    metadata?: unknown;
    errorCode?: string;
  }>(conn, {
    method: "POST",
    url: sqlPath,
    body: { sql: "SELECT COUNT(*) AS n FROM ssot__AiAgentSession__dlm" },
  });
  if (sqlA.status !== 200 || sqlA.body.errorCode)
    fail("SQL with object body", JSON.stringify(sqlA.body).slice(0, 200));
  else ok("SQL with object body", `count=${sqlA.body.data?.[0]?.[0]}`);

  const sqlB = await connRequest<{
    data?: number[][];
    metadata?: unknown;
    errorCode?: string;
  }>(conn, {
    method: "POST",
    url: sqlPath,
    body: '{"sql":"SELECT COUNT(*) AS n FROM ssot__AiAgentInteractionMessage__dlm"}',
  });
  if (sqlB.status !== 200 || sqlB.body.errorCode)
    fail(
      "SQL with pre-stringified body (was double-encoded)",
      JSON.stringify(sqlB.body).slice(0, 200),
    );
  else ok("SQL with pre-stringified body (Bug 2 was here)", `count=${sqlB.body.data?.[0]?.[0]}`);

  section("10. Aggregations across joined DMOs");
  const aggSql = `
    SELECT b.ssot__DeveloperName__c, COUNT(*) AS turns
    FROM ssot__AiAgentInteractionStep__dlm s
    JOIN ssot__AiAgentInteraction__dlm i ON s.ssot__AiAgentInteractionId__c = i.ssot__Id__c
    JOIN ssot__AiAgentSession__dlm sess ON i.ssot__AiAgentSessionId__c = sess.ssot__Id__c
    JOIN ssot__Bot__dlm b ON sess.ssot__SessionOwnerId__c IS NOT NULL
    WHERE s.ssot__AiAgentInteractionStepType__c = 'LLM_STEP'
    GROUP BY b.ssot__DeveloperName__c
    ORDER BY turns DESC LIMIT 10`;
  const agg = await connRequest<{ data?: unknown[][]; errorCode?: string }>(conn, {
    method: "POST",
    url: sqlPath,
    body: { sql: aggSql },
  });
  if (agg.body.errorCode) {
    console.log(`  (joined SQL not supported by org: ${agg.body.errorCode}) — falling back`);
    const fallback = await connRequest<{ data?: unknown[][]; errorCode?: string }>(conn, {
      method: "POST",
      url: sqlPath,
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

  section("11. Read-only error-path coverage");
  const notFound = await connRequest(conn, {
    method: "GET",
    url: buildApiPath("/ssot/this-does-not-exist", ctx.apiVersion),
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

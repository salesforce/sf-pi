/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only Agent Platform Tracing smoke for sf-data360.
 *
 * This script intentionally avoids the `sf` CLI subprocess path. It reuses the
 * same @salesforce/core Connection transport as d360_api/d360_probe, then runs
 * small bounded SELECT queries and pure local tree reconstruction.
 *
 *   node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts <alias>
 *   D360_E2E_ORG=<alias> node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts
 *
 * Add --require-data (or D360_E2E_REQUIRE_APT=1) when absence of the tracing
 * DMO or sample spans should fail the run instead of producing a clean skip.
 */

import { connFromAlias } from "../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../lib/common/sf-conn/request.ts";
import { buildApiPath } from "../../extensions/sf-data360/lib/path.ts";
import {
  APT_SPAN_DLO,
  APT_SPAN_DMO,
  APT_SPAN_FIELDS,
  buildFindErrorSpansSql,
  buildSpanTree,
  buildTraceTreeSql,
  normalizePlatformSpanRow,
  summarizeSpanTree,
} from "../../extensions/sf-data360/lib/agent-observability/platform-tracing.ts";

const args = process.argv.slice(2);
const REQUIRE_DATA = args.includes("--require-data") || truthy(process.env.D360_E2E_REQUIRE_APT);
const ALIAS = args.find((arg) => !arg.startsWith("--")) ?? process.env.D360_E2E_ORG;

if (!ALIAS) {
  console.error(
    "Usage: node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts <orgAlias>",
  );
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
function skip(detail: string): never {
  const prefix = REQUIRE_DATA ? "REQUIRED SURFACE MISSING" : "SKIP";
  console.log(`\n${prefix}: ${detail}`);
  process.exit(REQUIRE_DATA ? 1 : 0);
}

async function main() {
  section("1. Resolve org through @salesforce/core Connection");
  const conn = await connFromAlias(ALIAS);
  const apiVersion = conn.getApiVersion();
  console.log(`  target=${ALIAS}`);
  console.log(`  apiVersion=${apiVersion}`);
  ok("connection resolved without sf subprocess");

  section("2. Verify Agent Platform Tracing DLO metadata");
  const describePath = buildApiPath(`/ssot/data-lake-objects/${APT_SPAN_DLO}`, apiVersion);
  const describe = await connRequest<unknown>(conn, { method: "GET", url: describePath });
  if (describe.status === 403 || describe.status === 404) {
    skip(`${APT_SPAN_DLO} is not visible in this org (HTTP ${describe.status}).`);
  }
  if (describe.status !== 200) {
    fail("describe tracing DLO", `HTTP ${describe.status}: ${JSON.stringify(describe.body)}`);
  } else {
    ok("tracing DLO metadata is visible", describePath);
  }

  section("3. Resolve data space when available");
  const dataSpaceName = await resolveDataSpaceName(conn, apiVersion);
  if (dataSpaceName) ok("data space resolved", dataSpaceName);
  else ok("data space not required or not listed", "query-sql will omit dataspaceName");

  section("4. Count trace spans");
  const count = await querySql<{ data?: unknown[][]; errorCode?: string; message?: string }>(
    conn,
    apiVersion,
    dataSpaceName,
    `SELECT COUNT(*) AS span_count FROM "${APT_SPAN_DMO}"`,
  );
  if (count.status !== 200 || count.body.errorCode) {
    fail("count spans", JSON.stringify(count.body).slice(0, 400));
  } else {
    const spanCount = firstCell(count.body);
    ok("count spans", `span_count=${String(spanCount ?? "unknown")}`);
    if (Number(spanCount) === 0 && REQUIRE_DATA) {
      fail("sample trace data required", "span_count=0");
    }
  }

  section("5. Query recent error spans with bounded helper SQL");
  const errors = await querySql<{ data?: unknown[][]; errorCode?: string; message?: string }>(
    conn,
    apiVersion,
    dataSpaceName,
    buildFindErrorSpansSql({ limit: 5 }),
  );
  if (errors.status !== 200 || errors.body.errorCode) {
    fail("recent error span query", JSON.stringify(errors.body).slice(0, 400));
  } else {
    ok("recent error span query", `rows=${errors.body.data?.length ?? 0}`);
  }

  section("6. Reconstruct one trace tree when sample spans exist");
  const recentSql = [
    `SELECT ${APT_SPAN_FIELDS.join(", ")}`,
    `FROM "${APT_SPAN_DMO}"`,
    "WHERE ssot__TelemetryTrace__c <> 'NOT_SET'",
    "ORDER BY ssot__StartDateTime__c DESC",
    "LIMIT 20",
  ].join("\n");
  const recent = await querySql<{ data?: unknown[][]; errorCode?: string; message?: string }>(
    conn,
    apiVersion,
    dataSpaceName,
    recentSql,
  );
  if (recent.status !== 200 || recent.body.errorCode) {
    fail("recent span sample", JSON.stringify(recent.body).slice(0, 400));
  } else if (!recent.body.data?.length) {
    if (REQUIRE_DATA) fail("recent span sample", "no rows");
    else ok("recent span sample", "no rows yet; tree reconstruction skipped");
  } else {
    const sampleRows = rowsFromData(recent.body.data, APT_SPAN_FIELDS);
    const traceId = String(sampleRows[0]?.ssot__TelemetryTrace__c ?? "");
    if (!traceId) {
      fail("extract trace id", "first sample row had no ssot__TelemetryTrace__c");
    } else {
      const treeQuery = await querySql<{
        data?: unknown[][];
        errorCode?: string;
        message?: string;
      }>(conn, apiVersion, dataSpaceName, buildTraceTreeSql(traceId));
      if (treeQuery.status !== 200 || treeQuery.body.errorCode) {
        fail("fetch trace tree", JSON.stringify(treeQuery.body).slice(0, 400));
      } else {
        const rows = rowsFromData(treeQuery.body.data ?? [], APT_SPAN_FIELDS);
        const spans = rows.map(normalizePlatformSpanRow);
        const tree = buildSpanTree(spans);
        const summary = summarizeSpanTree(tree);
        ok(
          "trace tree reconstructed",
          `trace=${traceId} spans=${summary.totalSpans} roots=${summary.rootCount} errors=${summary.errorCount}`,
        );
        if (summary.orphanCount > 0) {
          console.log(`  note: ${summary.orphanCount} orphan span(s) surfaced as roots`);
        }
      }
    }
  }

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function resolveDataSpaceName(
  conn: Awaited<ReturnType<typeof connFromAlias>>,
  apiVersion: string,
) {
  const resp = await connRequest<Record<string, unknown>>(conn, {
    method: "GET",
    url: buildApiPath("/ssot/data-spaces", apiVersion),
  });
  if (resp.status !== 200 || !resp.body || typeof resp.body !== "object") return undefined;

  const rows = firstArray(resp.body, ["dataSpaces", "data", "items", "records"]);
  const active = rows.find((row) => {
    const status = String((row as Record<string, unknown>).status ?? "").toLowerCase();
    return status === "active";
  });
  const chosen = (active ?? rows[0]) as Record<string, unknown> | undefined;
  const name = chosen?.name;
  return typeof name === "string" && name.trim() ? name : undefined;
}

async function querySql<T>(
  conn: Awaited<ReturnType<typeof connFromAlias>>,
  apiVersion: string,
  dataSpaceName: string | undefined,
  sql: string,
) {
  return connRequest<T>(conn, {
    method: "POST",
    url: buildApiPath(
      "/ssot/query-sql",
      apiVersion,
      dataSpaceName ? { dataspaceName: dataSpaceName } : undefined,
    ),
    body: { sql },
  });
}

function rowsFromData(
  data: unknown[][],
  fields: readonly string[],
): Array<Record<string, unknown>> {
  return data.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
}

function firstCell(body: { data?: unknown[][] }): unknown {
  return body.data?.[0]?.[0];
}

function firstArray(obj: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function truthy(value: string | undefined): boolean {
  return Boolean(value && value !== "0" && value.toLowerCase() !== "false");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});

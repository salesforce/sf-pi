/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live sf-soql E2E harness. Default path is read-only. Pass --harness-data to
 * create and clean up temporary Account/Contact records for deterministic
 * relationship/subquery coverage in a non-production org.
 *
 * Usage:
 *   npm run e2e:sf-soql -- --org <alias> [--harness-data]
 */

import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import { apiVersion, requestJson, soqlConnection } from "../../extensions/sf-soql/lib/api.ts";
import { schemaDescribe, schemaRelationships } from "../../extensions/sf-soql/lib/schema.ts";
import { orgPreflight } from "../../extensions/sf-soql/lib/status.ts";
import { validateQuery } from "../../extensions/sf-soql/lib/validator.ts";
import {
  countQuery,
  explain,
  lastHistory,
  rerunHistory,
  runQuery,
  runQueryAll,
  sampleQuery,
} from "../../extensions/sf-soql/lib/runner.ts";
import { queryDraft } from "../../extensions/sf-soql/lib/draft.ts";
import { diagnoseFile } from "../../extensions/sf-soql/lib/file.ts";
import { exportQueryResult } from "../../extensions/sf-soql/lib/export.ts";
import { lspStatus } from "../../extensions/sf-soql/lib/lsp.ts";
import { schemaSearch } from "../../extensions/sf-soql/lib/search.ts";
import { runSosl } from "../../extensions/sf-soql/lib/sosl.ts";
import type {
  SfSoqlParams,
  SfSoqlSessionState,
  SoqlRunDigest,
  ToolResult,
} from "../../extensions/sf-soql/lib/types.ts";

interface Args {
  org?: string;
  harnessData?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") args.org = argv[++i];
    if (argv[i] === "--harness-data") args.harnessData = true;
  }
  return args;
}

function requireOrg(args: Args): string {
  const org = args.org ?? process.env.SF_SOQL_E2E_ORG;
  if (!org) {
    throw new Error(
      "Missing --org <alias> or SF_SOQL_E2E_ORG. This live E2E must target an explicit org.",
    );
  }
  return org;
}

function digestOf(result: ToolResult): SoqlRunDigest {
  const digest = result.details.digest as SoqlRunDigest | undefined;
  if (!digest)
    throw new Error(`Tool result did not include digest: ${JSON.stringify(result.details)}`);
  return digest;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertStatus(
  digest: SoqlRunDigest,
  expected: SoqlRunDigest["status"] | SoqlRunDigest["status"][],
): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(
    allowed.includes(digest.status),
    `${digest.action} expected status ${allowed.join("/")}, got ${digest.status}`,
  );
}

interface HarnessData {
  accountId: string;
  contactIds: string[];
}

async function createHarnessData(conn: Connection): Promise<HarnessData> {
  const stamp = Date.now();
  const account = await createRecord(conn, "Account", { Name: `SF SOQL E2E ${stamp}` });
  const contactA = await createRecord(conn, "Contact", {
    AccountId: account.id,
    LastName: `SOQL E2E A ${stamp}`,
    Email: `soql-e2e-a-${stamp}@example.com`,
  });
  const contactB = await createRecord(conn, "Contact", {
    AccountId: account.id,
    LastName: `SOQL E2E B ${stamp}`,
    Email: `soql-e2e-b-${stamp}@example.com`,
  });
  return { accountId: account.id, contactIds: [contactA.id, contactB.id] };
}

async function cleanupHarnessData(conn: Connection, data: HarnessData): Promise<void> {
  for (const contactId of data.contactIds) await deleteRecord(conn, "Contact", contactId);
  await deleteRecord(conn, "Account", data.accountId);
}

async function createRecord(
  conn: Connection,
  objectName: string,
  body: Record<string, unknown>,
): Promise<{ id: string; success: boolean }> {
  return requestJson<{ id: string; success: boolean }>(
    conn,
    "POST",
    `/services/data/v${apiVersion(conn)}/sobjects/${objectName}`,
    body,
  );
}

async function deleteRecord(conn: Connection, objectName: string, id: string): Promise<void> {
  await requestJson(
    conn,
    "DELETE",
    `/services/data/v${apiVersion(conn)}/sobjects/${objectName}/${id}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targetOrg = requireOrg(args);
  const conn = await soqlConnection(targetOrg);
  const state: SfSoqlSessionState = {};

  const run = async (
    label: string,
    fn: () => Promise<ToolResult>,
    expected: SoqlRunDigest["status"] | SoqlRunDigest["status"][] = "pass",
  ) => {
    const digest = digestOf(await fn());
    assertStatus(digest, expected);
    console.log(`✅ ${label}: ${digest.status} :: ${digest.title}`);
    return digest;
  };

  await run("org.preflight", () =>
    orgPreflight(conn, { action: "org.preflight", target_org: targetOrg }),
  );
  await run("schema.describe Account", () =>
    schemaDescribe(conn, { action: "schema.describe", target_org: targetOrg, object: "Account" }),
  );
  await run("schema.relationships Account", () =>
    schemaRelationships(conn, {
      action: "schema.relationships",
      target_org: targetOrg,
      object: "Account",
    }),
  );
  await run("schema.search harness", () =>
    schemaSearch(conn, {
      action: "schema.search",
      target_org: targetOrg,
      query: "harness",
      limit: 5,
    }),
  );
  const draft = await run("query.draft", () =>
    queryDraft(conn, {
      action: "query.draft",
      target_org: targetOrg,
      object: "Account",
      fields: ["Id", "Name", "OwnerId"],
      filters: ["Name != null"],
      order_by: "Name ASC",
      max_rows: 5,
      intent: "E2E draft smoke",
    }),
  );
  assert(
    draft.query?.normalized?.includes("LIMIT 5"),
    "query.draft should include an explicit LIMIT",
  );
  await run("lsp.status", () =>
    Promise.resolve(lspStatus({ action: "lsp.status", target_org: targetOrg })),
  );
  await run("query.validate relationship", () =>
    validateQuery(conn, {
      action: "query.validate",
      target_org: targetOrg,
      query: "SELECT Id, Name, Owner.Name FROM Account LIMIT 1",
    }),
  );
  await run(
    "query.validate invalid field",
    () =>
      validateQuery(conn, {
        action: "query.validate",
        target_org: targetOrg,
        query: "SELECT Id, Definitely_Not_A_Field__c FROM Account LIMIT 1",
      }),
    "fail",
  );
  const picklistWarning = await run(
    "query.validate picklist literal",
    () =>
      validateQuery(conn, {
        action: "query.validate",
        target_org: targetOrg,
        query:
          "SELECT Type, COUNT(Id) total FROM Account WHERE Type = 'Definitely_Not_A_Type' GROUP BY Type ORDER BY Type LIMIT 5",
      }),
    "warning",
  );
  assert(
    picklistWarning.validation?.findings.some((finding) => finding.label === "Picklist"),
    "query.validate did not warn for an inactive picklist literal",
  );
  await run("query.explain", () =>
    explain(
      conn,
      {
        action: "query.explain",
        target_org: targetOrg,
        query: "SELECT Id, Name FROM Account LIMIT 1",
      },
      state,
    ),
  );
  const sample = await run("query.sample", () =>
    sampleQuery(
      conn,
      {
        action: "query.sample",
        target_org: targetOrg,
        query: "SELECT Id, Name FROM Account",
        max_rows: 1,
      },
      state,
    ),
  );
  assert(
    sample.artifacts?.some(
      (artifact) => artifact.kind === "flattened-csv" && existsSync(artifact.path),
    ),
    "query.sample did not write flattened CSV artifact",
  );

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sf-soql-e2e-"));
  const soqlFile = path.join(tempDir, "account-smoke.soql");
  await writeFile(soqlFile, "SELECT Id, Name FROM Account LIMIT 1\n", "utf8");
  await run("file.diagnose .soql", () =>
    diagnoseFile(
      conn,
      { action: "file.diagnose", target_org: targetOrg, file: soqlFile },
      process.cwd(),
    ),
  );
  const apexFile = path.join(tempDir, "EmbeddedSoql.cls");
  await writeFile(
    apexFile,
    "public class EmbeddedSoql { public void run(){ List<Account> rows = [SELECT Id, Name FROM Account LIMIT 1]; } }\n",
    "utf8",
  );
  await run("file.diagnose Apex", () =>
    diagnoseFile(
      conn,
      { action: "file.diagnose", target_org: targetOrg, file: apexFile },
      process.cwd(),
    ),
  );
  const exportDigest = await run("query.export csv", () =>
    exportQueryResult(
      {
        action: "query.export",
        target_org: targetOrg,
        output_file: path.join(tempDir, "latest.csv"),
        format: "csv",
      },
      state,
      process.cwd(),
    ),
  );
  assert(
    exportDigest.artifacts?.some((artifact) => existsSync(artifact.path)),
    "query.export should write an output artifact",
  );
  await run("sosl.run", () =>
    runSosl(conn, {
      action: "sosl.run",
      target_org: targetOrg,
      query: "FIND {Commerce} IN ALL FIELDS RETURNING Account(Id, Name LIMIT 2)",
      max_rows: 2,
    }),
  );

  if (args.harnessData) {
    const harness = await createHarnessData(conn);
    try {
      const subquery = await run("query.run harness subquery", () =>
        runQuery(
          conn,
          {
            action: "query.run",
            target_org: targetOrg,
            query: `SELECT Id, Name, (SELECT Id, LastName, Email FROM Contacts ORDER BY LastName) FROM Account WHERE Id = '${harness.accountId}' LIMIT 1`,
            max_rows: 5,
          },
          state,
        ),
      );
      assert(
        subquery.result?.rows_returned === 1,
        "harness subquery should return one parent Account row",
      );
      assert(
        subquery.result?.sample_rows?.length === 2,
        "harness subquery should flatten two Contact sample rows",
      );
      assert(
        subquery.result?.columns?.includes("Contacts.Email"),
        "harness subquery should include flattened Contacts.Email column",
      );
    } finally {
      await cleanupHarnessData(conn, harness);
    }
  }

  const safety = await run(
    "query.run safety gate",
    () =>
      runQuery(
        conn,
        { action: "query.run", target_org: targetOrg, query: "SELECT Id, Name FROM Account" },
        state,
      ),
    "warning",
  );
  assert(
    safety.validation?.verdict === "review",
    "query.run without LIMIT should return review verdict",
  );

  await run("query.run bounded", () =>
    runQuery(
      conn,
      { action: "query.run", target_org: targetOrg, query: "SELECT Id, Name FROM Account LIMIT 1" },
      state,
    ),
  );
  await run("query.run tooling", () =>
    runQuery(
      conn,
      {
        action: "query.run",
        target_org: targetOrg,
        api: "tooling",
        query: "SELECT Id, Name FROM ApexClass LIMIT 1",
        max_rows: 1,
      } as SfSoqlParams,
      state,
    ),
  );
  await run("query.count", () =>
    countQuery(
      conn,
      { action: "query.count", target_org: targetOrg, query: "SELECT Id FROM Account LIMIT 1" },
      state,
    ),
  );
  await run(
    "query.queryAll",
    () =>
      runQueryAll(
        conn,
        {
          action: "query.queryAll",
          target_org: targetOrg,
          query: "SELECT Id, Name FROM Account LIMIT 1",
          max_rows: 1,
          include_deleted: true,
        },
        state,
      ),
    "warning",
  );
  await run("history.last", () => Promise.resolve(lastHistory(state)), "warning");
  await run(
    "history.rerun",
    () => rerunHistory(conn, { action: "history.rerun", target_org: targetOrg }, state),
    "warning",
  );

  console.log("SF SOQL E2E passed.");
}

await main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});

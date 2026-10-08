/* SPDX-License-Identifier: Apache-2.0 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { buildData360Digest, compactDigestText } from "../lib/digest.ts";
import { boundedExpandedPayload } from "../lib/presentation-data.ts";
import { presentSfData360Result } from "../lib/result.ts";
import {
  namespaceIcon,
  renderData360DigestMarkdown,
  renderSfData360Result,
} from "../lib/render.ts";
import { formatData360Sql } from "../lib/sql-format.ts";
import type { Data360RunDigest } from "../lib/types.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const queryResult = {
  ok: true,
  tool: "sf_data360",
  action: "query.sql.run",
  namespace: "query",
  targetOrg: "ExampleData360Org",
  instanceUrl: "https://example.my.salesforce.com",
  apiVersion: "67.0",
  operationId: "d360_query_sql",
  safety: "safe_post",
  status: 201,
  transport: "connect",
  warnings: ["Query API V3 unavailable; used the Connect API endpoint instead: invalid_scope"],
  request: {
    method: "POST",
    path: "/services/data/v67.0/ssot/query-sql",
    url: "https://example.my.salesforce.com/services/data/v67.0/ssot/query-sql",
    body: {
      sql: 'SELECT "Id__c", "StartTimestamp__c" FROM "ExampleSession__dlm" WHERE "Status__c" = \'Open\' ORDER BY "StartTimestamp__c" DESC LIMIT 2',
    },
  },
  response: {
    data: [
      ["session-1", "2026-10-05T04:50:58.321Z"],
      ["session-2", "2026-10-05T04:48:01.000Z"],
    ],
    metadata: [
      { name: "Id__c", type: "Varchar", nullable: false },
      { name: "StartTimestamp__c", type: "TimestampTZ", nullable: true },
    ],
    returnedRows: 2,
    status: {
      completionStatus: "ResultsProduced",
      rowCount: 2,
      rowsProcessed: 774,
      chunkCount: 1,
      wallClockTime: 0.033,
      queryId: "query-123",
    },
  },
  summary: "Query completed",
};

describe("Data 360 Run Card presentation", () => {
  it("formats SQL into readable clauses without damaging quoted values", () => {
    const formatted = formatData360Sql(queryResult.request.body.sql);
    expect(formatted).toContain('SELECT\n  "Id__c",');
    expect(formatted).toContain('\nFROM "ExampleSession__dlm"');
    expect(formatted).toContain("\nWHERE \"Status__c\" = 'Open'");
    expect(formatted).toContain('\nORDER BY "StartTimestamp__c" DESC');
    expect(formatted).toContain("\nLIMIT 2");
  });

  it("keeps inline model content semantic and stores a rich digest", async () => {
    const presented = await presentSfData360Result(
      {
        action: "query.sql.run",
        target_org: "ExampleData360Org",
        output_mode: "inline",
        params: { sql: queryResult.request.body.sql },
      },
      queryResult,
      "inline",
    );
    const text = presented.content[0]?.text ?? "";
    expect(text.trimStart().startsWith("{")).toBe(false);
    expect(text).toContain("2 rows");
    expect(text).toContain("Connect API fallback");
    expect(text).not.toContain("capabilityKind");
    expect(presented.details.digest).toMatchObject({
      action: "query.sql.run",
      namespace: "query",
      status: "warning",
      api_calls: expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          url: "https://example.my.salesforce.com/services/data/v67.0/ssot/query-sql",
        }),
      ]),
    });
    expect(presented.structuredContent).toMatchObject({
      outcome: { action: "query.sql.run", status: "warning" },
      request: { method: "POST" },
      api_calls: expect.arrayContaining([expect.objectContaining({ method: "POST" })]),
      next_step: "Use query.sql.metadata for schema or query.sql.rows for additional pages.",
    });
  });

  it("renders an expanded card with full URL, SQL, request, response, and table", async () => {
    const presented = await presentSfData360Result(
      { action: "query.sql.run", params: { sql: queryResult.request.body.sql } },
      queryResult,
      "summary",
    );
    const digest = presented.details.digest as Data360RunDigest;
    const collapsed = renderData360DigestMarkdown(digest);
    expect(collapsed).toContain(
      "https://example.my.salesforce.com/services/data/v67.0/ssot/query-sql",
    );
    expect(collapsed).toContain("—— 📥 Request ——");
    expect(collapsed).toContain("—— 📤 Response ——");
    expect(collapsed).toContain("expand for SQL");
    expect(collapsed).not.toContain("complete request/response");
    expect(collapsed).not.toContain("—— 🧾 SQL ——");
    expect(collapsed).not.toContain("—— 📄 Evidence ——");
    expect(collapsed).not.toContain("—— ➡️ Next Step ——");

    const rendered = renderData360DigestMarkdown(digest, { expanded: true });
    expect(rendered).toContain("⚠️ 🧮 Data 360 Query");
    expect(rendered).toContain(
      "https://example.my.salesforce.com/services/data/v67.0/ssot/query-sql",
    );
    expect(rendered).toContain("—— 🧾 SQL ——");
    expect(rendered).toContain("SELECT");
    expect(rendered).toContain("—— 📥 Request ——");
    expect(rendered).toContain("—— 📤 Response ——");
    expect(rendered).toContain("Id__c");
    expect(rendered).not.toContain("—— 📄 Evidence ——");
    expect(rendered).not.toContain("—— ➡️ Next Step ——");
    expect(rendered).not.toContain("\\n");
  });

  it("keeps evidence and next-step guidance model-visible but out of the human card", () => {
    const digest = buildData360Digest({
      input: { action: "harmonize.dmo.list" },
      result: {
        ok: true,
        action: "harmonize.dmo.list",
        namespace: "harmonize",
        next_actions: ["Inspect the selected DMO."],
        response: { dataModelObject: [] },
        summary: "DMOs listed",
      },
      artifactPath: "artifacts/example-data360-output.json",
      outputMode: "summary",
    });

    expect(digest.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Evidence", "Next Step"]),
    );
    expect(compactDigestText(digest)).toContain("Evidence:");
    expect(compactDigestText(digest)).toContain("Next:");
    expect(renderData360DigestMarkdown(digest)).not.toContain("Evidence");
    expect(renderData360DigestMarkdown(digest)).not.toContain("Next Step");
    expect(renderData360DigestMarkdown(digest, { expanded: true })).not.toContain("Evidence");
    expect(renderData360DigestMarkdown(digest, { expanded: true })).not.toContain("Next Step");
  });

  it("highlights offset pagination and keeps the collapsed response preview to eight lines", () => {
    const dataModelObject = Array.from({ length: 200 }, (_value, index) => ({
      name: `Example_${index + 401}__dlm`,
      label: `Example ${index + 401}`,
      id: `record-${index + 401}`,
    }));
    const digest = buildData360Digest({
      input: {
        action: "harmonize.dmo.list",
        params: { limit: 200, offset: 400 },
      },
      result: {
        ok: true,
        action: "harmonize.dmo.list",
        namespace: "harmonize",
        targetOrg: "ExampleData360Org",
        instanceUrl: "https://example.my.salesforce.com",
        operationId: "d360_dmo_list",
        safety: "read",
        status: 200,
        transport: "connect",
        request: {
          method: "GET",
          path: "/services/data/v68.0/ssot/data-model-objects?limit=200&offset=400",
        },
        response: { dataModelObject },
        summary: "DMOs listed",
      },
      outputMode: "summary",
    });

    expect(digest.pagination).toMatchObject({
      kind: "offset",
      offset: 400,
      limit: 200,
      page: 3,
      start: 401,
      end: 600,
      returned: 200,
    });
    const card = renderData360DigestMarkdown(digest);
    expect(card).toContain("Page 3 · items 401–600 · batch size 200");
    expect(card).toContain("offset=400 · limit=200 · returned=200");
    expect(card).toContain("—— 📥 Request ——");
    expect(card).toContain("🔒 Safety");
    expect(card).toContain("—— 📤 Response ——");
    expect(card).toContain('"dataModelObject": [');
    expect(card).toContain("response preview capped at 8 lines");
    expect(card).not.toContain('"name": "Example_402__dlm"');
  });

  it("keeps the mandatory scaffold bounded at narrow and wide terminal widths", () => {
    const digest = buildData360Digest({
      input: { action: "harmonize.dmo.list", params: { limit: 200, offset: 400 } },
      result: {
        ok: true,
        action: "harmonize.dmo.list",
        namespace: "harmonize",
        targetOrg: "ExampleData360Org",
        instanceUrl: "https://example.my.salesforce.com",
        operationId: "d360_dmo_list",
        safety: "read",
        status: 200,
        transport: "connect",
        request: {
          method: "GET",
          path: "/services/data/v68.0/ssot/data-model-objects?limit=200&offset=400",
        },
        response: { dataModelObject: [{ name: "Example__dlm", label: "Example" }] },
        summary: "DMOs listed",
      },
      outputMode: "summary",
    });
    const component = renderSfData360Result({ details: { digest } }, { expanded: false }, theme);
    for (const width of [48, 80, 120]) {
      const lines = component.render(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("renders metadata fields and mutation payloads as structured cards", async () => {
    const metadata = await presentSfData360Result(
      { action: "harmonize.dmo.get", params: { dmoName: "Example__dlm" } },
      {
        ok: true,
        action: "harmonize.dmo.get",
        namespace: "harmonize",
        targetOrg: "ExampleData360Org",
        instanceUrl: "https://example.my.salesforce.com",
        apiVersion: "67.0",
        status: 200,
        apiName: "Example__dlm",
        fieldCount: 2,
        request: {
          method: "GET",
          path: "/services/data/v67.0/ssot/data-model-objects/Example__dlm",
          url: "https://example.my.salesforce.com/services/data/v67.0/ssot/data-model-objects/Example__dlm",
        },
        response: {
          name: "Example__dlm",
          label: "Example",
          category: "PROFILE",
          fields: [
            { name: "Id__c", label: "Id", dataType: "Text", isPrimaryKey: true },
            { name: "Name__c", label: "Name", dataType: "Text", isPrimaryKey: false },
          ],
        },
        summary: "DMO described",
      },
      "summary",
    );
    const metadataCard = renderData360DigestMarkdown(metadata.details.digest as Data360RunDigest, {
      expanded: true,
    });
    expect(metadataCard).toContain("🧩 Data 360 Harmonize");
    expect(metadataCard).toContain(
      "https://example.my.salesforce.com/services/data/v67.0/ssot/data-model-objects/Example__dlm",
    );
    expect(metadataCard).toContain("Id__c");
    expect(metadataCard).toContain("Primary Key");

    const dryRun = await presentSfData360Result(
      { action: "prepare.stream.create", dry_run: true },
      {
        ok: true,
        action: "prepare.stream.create",
        namespace: "prepare",
        dryRun: true,
        targetOrg: "ExampleData360Org",
        instanceUrl: "https://example.my.salesforce.com",
        safety: "confirmed",
        request: {
          method: "POST",
          path: "/services/data/v67.0/ssot/data-streams",
          url: "https://example.my.salesforce.com/services/data/v67.0/ssot/data-streams",
          body: { name: "ExampleStream", connectorType: "IngestApi" },
        },
        summary: "Resolved stream create",
      },
      "summary",
    );
    const dryRunCard = renderData360DigestMarkdown(dryRun.details.digest as Data360RunDigest, {
      expanded: true,
    });
    expect(dryRunCard).toContain("🟡 🧱 Data 360 Prepare");
    expect(dryRunCard).toContain('"connectorType": "IngestApi"');
    expect(dryRunCard).toContain("Dry run · not executed");
  });

  it("renders partial readiness as a warning instead of a successful outcome", async () => {
    const presented = await presentSfData360Result(
      { action: "orchestrate.agent_behavior_investigation.run" },
      {
        ok: true,
        action: "orchestrate.agent_behavior_investigation.run",
        namespace: "orchestrate",
        readiness: "partial",
        missingSurfaces: ["Agent Platform Tracing"],
        summary: "Agent behavior investigation complete",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("⚠️");
    expect(presented.details.digest).toMatchObject({ status: "warning" });
  });

  it("does not invent a Connect transport when no request was attempted", async () => {
    const presented = await presentSfData360Result(
      { action: "query.this_does_not_exist" },
      {
        ok: false,
        tool: "sf_data360",
        action: "query.this_does_not_exist",
        namespace: "query",
        error: "UNKNOWN_ACTION",
        summary: "Unknown action",
      },
      "summary",
    );

    expect(presented.content[0]?.text).not.toContain("Transport:");
    expect(presented.details.digest).not.toHaveProperty("transport");
  });

  it("renders Discover search criteria and matching-action previews without fake API sections", async () => {
    const result = {
      ok: true,
      tool: "sf_data360",
      action: "discover.action.search",
      namespace: "discover",
      query: "activation target",
      summary: "6 matching Data 360 actions",
      results: Array.from({ length: 6 }, (_value, index) => ({
        namespace: index < 5 ? "activate" : "semantic",
        action: `activate.activation_target.example_${index + 1}`,
        family: "Activation",
        safety: index < 4 ? "read" : "confirmed",
        endpoint: { method: "GET", path: `/ssot/activation-targets/example-${index + 1}` },
      })),
    };
    const presented = await presentSfData360Result(
      { action: "discover.action.search", params: { query: "activation target" } },
      result,
      "summary",
    );
    const digest = presented.details.digest as Data360RunDigest;
    const card = renderData360DigestMarkdown(digest);

    expect(card).toContain("—— 🎯 Outcome ——");
    expect(card).toContain("—— 🔎 Search ——");
    expect(card).toContain("activation target");
    expect(card).toContain("—— 📋 Matching Actions ——");
    expect(card).toContain("activation_target.example_1");
    expect(card).toContain("1 more row(s) returned");
    expect(card.indexOf("Matching Actions")).toBeGreaterThan(card.indexOf("Outcome"));
    expect(card).not.toContain("   API");
    expect(card).not.toContain("—— 📥 Request ——");
    expect(card).not.toContain("—— 📤 Response ——");

    const expanded = renderSfData360Result(presented, { expanded: true }, theme)
      .render(120)
      .join("\n");
    expect(expanded).toContain("—— 🧾 Raw Result ——");
    expect(expanded).toContain("activate.activation_target.example_6");
  });

  it("renders Observe metrics and their source API instead of empty request placeholders", async () => {
    const rows = [
      { operation: "Planner", callCount: 12, averageMs: 240, p95Ms: 610, maxMs: 1200 },
      { operation: "Prompt Template", callCount: 8, averageMs: 180, p95Ms: 420, maxMs: 890 },
    ];
    const result = {
      ok: true,
      action: "observe.trace.operation_latency_summary",
      namespace: "observe",
      targetOrg: "ExampleData360Org",
      dataspaceName: "default",
      runbook: "agent_observability.operation_latency_summary",
      result: { data: { rows, rowCount: rows.length }, sql: "SELECT operation, COUNT(*)" },
      sourceCalls: [
        {
          action: "query.sql.run",
          status: 201,
          request: { method: "POST", path: "/services/data/v68.0/ssot/query-sql" },
        },
      ],
      summary: "Operation latency summary: 2 rows",
    };
    const presented = await presentSfData360Result(
      { action: "observe.trace.operation_latency_summary", params: { since: "30d" } },
      result,
      "summary",
    );
    const card = renderData360DigestMarkdown(presented.details.digest as Data360RunDigest);

    expect(card).toContain("POST");
    expect(card).toContain("/ssot/query-sql");
    expect(card).toContain("—— 📊 Operation Latency ——");
    expect(card).toContain("Planner");
    expect(card).toContain("Prompt Template");
    expect(card).not.toContain("No API request recorded");
    expect(card).not.toContain("No API response recorded");
  });

  it("renders Orchestrate journey previews without fake local request and response sections", async () => {
    const journeys = Array.from({ length: 6 }, (_value, index) => ({
      name: `journey_${index + 1}`,
      summary: `Journey ${index + 1}`,
      phases: ["connect", "prepare", "harmonize"],
      planAction: `journey_${index + 1}.plan`,
      runAction: `journey_${index + 1}.run`,
    }));
    const presented = await presentSfData360Result(
      { action: "orchestrate.journey.list" },
      {
        ok: true,
        action: "orchestrate.journey.list",
        namespace: "orchestrate",
        journeys,
        summary: "Listed Data 360 outcome journeys",
      },
      "summary",
    );
    const card = renderData360DigestMarkdown(presented.details.digest as Data360RunDigest);

    expect(card).toContain("—— 🧭 Outcome Journeys ——");
    expect(card).toContain("journey_1");
    expect(card).toContain("1 more row(s) returned");
    expect(card).not.toContain("   API");
    expect(card).not.toContain("—— 📥 Request ——");
    expect(card).not.toContain("—— 📤 Response ——");
  });

  it("shows five compact sample rows and the complete sanitized payload when expanded", async () => {
    const connectors = Array.from({ length: 60 }, (_value, index) => ({
      name: `connector_${index + 1}`,
      label: `Connector ${index + 1}`,
      releaseLevel: "GA",
      ...(index === 59 ? { password: "must-not-render" } : {}),
    }));
    const result = {
      ok: true,
      action: "connect.connector.list",
      namespace: "connect",
      targetOrg: "ExampleData360Org",
      instanceUrl: "https://example.my.salesforce.com",
      operationId: "d360_connector_list",
      safety: "read",
      status: 200,
      transport: "connect",
      request: { method: "GET", path: "/services/data/v68.0/ssot/connectors" },
      response: { connectorInfoList: connectors },
      summary: "Connectors listed",
    };
    const presented = await presentSfData360Result(
      { action: "connect.connector.list" },
      result,
      "summary",
    );
    const digest = presented.details.digest as Data360RunDigest;
    const collapsed = renderData360DigestMarkdown(digest);
    expect(collapsed).toContain("—— 📋 Connectors ——");
    expect(collapsed).toContain("connector_5");
    expect(collapsed).not.toContain("connector_6");
    expect(collapsed.indexOf("Connectors")).toBeGreaterThan(collapsed.indexOf("Outcome"));

    const expanded = renderSfData360Result(presented, { expanded: true }, theme)
      .render(140)
      .join("\n");
    expect(expanded).toContain("connector_60");
    expect(expanded).toContain("[REDACTED]");
    expect(expanded).not.toContain("must-not-render");
    expect(expanded).not.toContain("response preview capped at 8 lines");
  });

  it("bounds pathological expanded payloads at the approved safety limit", () => {
    const bounded = boundedExpandedPayload({
      rows: Array.from({ length: 6_000 }, (_value, index) => ({ index, value: `row-${index}` })),
    });

    expect(bounded.truncated).toBe(true);
    expect(bounded.lines.length).toBeLessThanOrEqual(5_000);
    expect(bounded.totalLines).toBeGreaterThan(bounded.lines.length);
  });

  it("uses a unique icon for every business namespace", () => {
    const namespaces = [
      "discover",
      "connect",
      "prepare",
      "harmonize",
      "segment",
      "activate",
      "query",
      "semantic",
      "observe",
      "orchestrate",
      "api",
    ] as const;
    expect(new Set(namespaces.map(namespaceIcon)).size).toBe(namespaces.length);
  });
});

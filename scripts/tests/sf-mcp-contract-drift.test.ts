/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  buildContractSnapshot,
  compareContractSnapshots,
  type RawObservedTool,
} from "../e2e/lib/sf-mcp-contract.ts";
import { parseSfMcpContractArgs } from "../e2e/sf-mcp-contract-canary.ts";

const tools: RawObservedTool[] = [
  {
    name: "mcp__salesforce_dx__run_soql_query",
    description: "Run a query.",
    parameters: {
      required: ["query"],
      properties: { query: { description: "SOQL", type: "string" } },
      type: "object",
    },
    annotations: { openWorldHint: false, readOnlyHint: true },
  },
  {
    name: "mcp__salesforce_dx__get_username",
    description: "Resolve a target.",
    parameters: { properties: {}, type: "object" },
    annotations: { readOnlyHint: true },
  },
];

describe("SF MCP contract drift", () => {
  it("requires an explicit org and rejects unknown arguments", () => {
    expect(parseSfMcpContractArgs(["--org", "developer-org", "--version", "latest"])).toMatchObject(
      {
        org: "developer-org",
        version: "latest",
      },
    );
    expect(() => parseSfMcpContractArgs([])).toThrow(/--org requires/i);
    expect(() => parseSfMcpContractArgs(["--org", "developer-org", "--mutate"])).toThrow(
      /unknown argument/i,
    );
  });

  it("normalizes tool order and object key order", () => {
    const snapshot = buildContractSnapshot(
      {
        version: "1.2.3",
        integrity: "sha512-example",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      [...tools].reverse(),
    );

    expect(snapshot.tools.map((tool) => tool.name)).toEqual(["get_username", "run_soql_query"]);
    expect(snapshot.tools[1]?.parameters).toEqual({
      properties: { query: { type: "string" } },
      required: ["query"],
      type: "object",
    });
    expect(snapshot.tools[1]?.schemaDescriptionHash).toMatch(/^sha256:/);
  });

  it("treats a version-only change as review", () => {
    const baseline = buildContractSnapshot(
      { version: "1.2.3", integrity: "sha512-old", modifiedAt: "old" },
      tools,
    );
    const candidate = buildContractSnapshot(
      { version: "1.2.4", integrity: "sha512-new", modifiedAt: "new" },
      tools,
    );

    expect(compareContractSnapshots(baseline, candidate)).toMatchObject({
      status: "review",
      changes: [expect.objectContaining({ kind: "package-version", severity: "review" })],
    });
  });

  it("fails critically when one published version changes integrity", () => {
    const baseline = buildContractSnapshot(
      { version: "1.2.3", integrity: "sha512-old", modifiedAt: "old" },
      tools,
    );
    const candidate = buildContractSnapshot(
      { version: "1.2.3", integrity: "sha512-republished", modifiedAt: "new" },
      tools,
    );

    expect(compareContractSnapshots(baseline, candidate)).toMatchObject({
      status: "breaking",
      changes: [expect.objectContaining({ kind: "package-integrity", severity: "breaking" })],
    });
  });

  it("classifies added, removed, schema, annotation, and description drift", () => {
    const baseline = buildContractSnapshot(
      { version: "1.2.3", integrity: "sha512-same", modifiedAt: "old" },
      tools,
    );
    const candidate = buildContractSnapshot(
      { version: "1.2.3", integrity: "sha512-same", modifiedAt: "new" },
      [
        {
          ...tools[0]!,
          description: "Changed query wording.",
          parameters: { type: "object", properties: { query: { type: "number" } } },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        {
          name: "mcp__salesforce_dx__new_tool",
          description: "New.",
          parameters: { type: "object" },
        },
      ],
    );
    const drift = compareContractSnapshots(baseline, candidate);

    expect(drift.status).toBe("breaking");
    expect(drift.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool-added", tool: "new_tool" }),
        expect.objectContaining({ kind: "tool-removed", tool: "get_username" }),
        expect.objectContaining({ kind: "schema", tool: "run_soql_query" }),
        expect.objectContaining({ kind: "annotations", tool: "run_soql_query" }),
        expect.objectContaining({
          kind: "description",
          tool: "run_soql_query",
          severity: "review",
        }),
      ]),
    );
  });
});

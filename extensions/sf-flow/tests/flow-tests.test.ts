/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import {
  defaultFlowTestAdapter,
  discoverFlowTests,
  getFlowTestResult,
  runFlowTests,
  type FlowTestAdapter,
} from "../lib/flow-tests.ts";
import { orgPreflight } from "../lib/operations.ts";
import type { SfFlowSessionState } from "../lib/types.ts";

const writeArtifact = async (kind: string, filename: string) => ({
  path: `/tmp/${filename}`,
  kind,
});

describe("SF Flow targeted tests", () => {
  it("discovers multiple FlowTests without selecting Metadata in a multi-row query", async () => {
    const tests = [
      { Id: "320000000000001", DeveloperName: "Happy_Path", MasterLabel: "Happy Path" },
      { Id: "320000000000002", DeveloperName: "Alternate_Path", MasterLabel: "Alternate Path" },
    ];
    const query = vi.fn(async ({ soql }: { soql: string }) => {
      if (!soql.includes("WHERE Id =")) {
        if (soql.includes("Metadata")) {
          throw new Error("Tooling Metadata queries must return exactly one row");
        }
        return { records: tests };
      }
      const test = tests.find((candidate) => soql.includes(candidate.Id));
      return {
        records: test ? [{ ...test, Metadata: { flowApiName: "Fixture_Flow" } }] : [],
      };
    });

    const candidates = await defaultFlowTestAdapter.discover({ query } as never, 10);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        api: "tooling",
        soql: expect.not.stringContaining("Metadata"),
      }),
    );
    expect(candidates).toEqual([
      {
        flow_name: "Fixture_Flow",
        namespace: undefined,
        test_names: ["Happy_Path", "Alternate_Path"],
      },
    ]);
  });

  it("preflights the same bounded FlowTest discovery path", async () => {
    const query = vi.fn(async ({ soql }: { soql: string }) => {
      if (soql.includes("FlowDefinitionView")) return { records: [], totalSize: 0 };
      if (soql.includes("WHERE Id =")) {
        return { records: [{ Metadata: { flowApiName: "Fixture_Flow" } }], totalSize: 1 };
      }
      return {
        records: [{ Id: "320000000000001", DeveloperName: "Happy_Path" }],
        totalSize: 1,
      };
    });

    const result = await orgPreflight({ query, target: { apiVersion: "67.0" } } as never, {
      action: "org.preflight",
      target_org: "developer-org",
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(result.details).toMatchObject({
      ok: true,
      flow_test_discovery: "available",
      flow_test_candidates: 1,
    });
  });

  it("discovers only Flow tests", async () => {
    const adapter: FlowTestAdapter = {
      discover: async () => [{ flow_name: "Request_Intake", test_names: ["Happy_Path"] }],
      run: vi.fn(),
      result: vi.fn(),
    };

    const result = await discoverFlowTests(
      { action: "test.discover", target_org: "sandbox" },
      {} as never,
      { adapter, writeArtifact },
    );

    expect(result.details.candidates).toEqual([
      { flow_name: "Request_Intake", test_names: ["Happy_Path"] },
    ]);
  });

  it("fails closed when Salesforce skips a run without executing tests", async () => {
    const adapter: FlowTestAdapter = {
      discover: vi.fn(),
      run: vi.fn(),
      result: async () => ({
        run_id: "707000000000003",
        queued: false,
        outcome: "Skipped",
        tests: [],
        raw: { summary: { outcome: "Skipped", testsRan: 0 } },
      }),
    };

    const result = await getFlowTestResult(
      { action: "test.result", target_org: "sandbox", run_id: "707000000000003" },
      {} as never,
      {},
      { adapter, writeArtifact },
    );

    expect(result.details.ok).toBe(false);
    expect(result.content[0]?.text).toContain("No Tests Executed");
  });

  it("runs specified Flow tests with the Flow category", async () => {
    const state: SfFlowSessionState = {};
    const run = vi.fn<FlowTestAdapter["run"]>().mockResolvedValue({
      run_id: "707000000000001",
      queued: true,
    });
    const adapter: FlowTestAdapter = {
      discover: vi.fn(),
      run,
      result: vi.fn(),
    };

    const result = await runFlowTests(
      {
        action: "test.run",
        target_org: "sandbox",
        tests: ["Request_Intake.Happy_Path"],
        wait_seconds: 0,
      },
      {} as never,
      state,
      { adapter, writeArtifact },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Flow",
        tests: ["Request_Intake.Happy_Path"],
      }),
    );
    expect(result.details.run_id).toBe("707000000000001");
    expect(state.last_test_run_id).toBe("707000000000001");
  });

  it("retrieves normalized Flow test results", async () => {
    const adapter: FlowTestAdapter = {
      discover: vi.fn(),
      run: vi.fn(),
      result: async () => ({
        run_id: "707000000000002",
        queued: false,
        outcome: "Passed",
        tests: [
          {
            flow_name: "Request_Intake",
            test_name: "Happy_Path",
            outcome: "Pass",
            run_time_ms: 25,
          },
          {
            flow_name: "Request_Intake",
            test_name: "Existing_Value_Path",
            outcome: "Pass",
            run_time_ms: 18,
          },
        ],
        raw: { summary: { outcome: "Passed" } },
      }),
    };

    const result = await getFlowTestResult(
      { action: "test.result", target_org: "sandbox", run_id: "707000000000002" },
      {} as never,
      {},
      { adapter, writeArtifact },
    );

    expect(result.details).toMatchObject({ ok: true, outcome: "Passed", passing: 2, failing: 0 });
    expect(result.content[0]?.text).toContain("Request_Intake.Happy_Path: Pass · 25ms");
    expect(result.content[0]?.text).toContain("Request_Intake.Existing_Value_Path: Pass · 18ms");
    expect(result.details.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tests" }),
        expect.objectContaining({ kind: "test-reports" }),
      ]),
    );
  });
});

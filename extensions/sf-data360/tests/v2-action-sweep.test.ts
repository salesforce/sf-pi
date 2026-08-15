/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import {
  buildV2SweepPlan,
  canDryRun,
  classifyLiveReadResult,
  classifyUsefulMissingParamResult,
  paramsForDryRun,
  paramsForLiveRead,
  parseV2SweepArgs,
} from "../../../scripts/e2e/data360-v2-action-sweep.ts";
import {
  buildDloV2LifecyclePlan,
  canRunV2MutationLifecycle,
  runV2LifecyclePlan,
} from "../../../scripts/e2e/data360-v2/lifecycle.ts";
import type { Data360V2ActionDefinition, Data360V2Input } from "../lib/v2/action-types.ts";

const restAction: Data360V2ActionDefinition = {
  tool: "data360_prepare",
  action: "stream.get",
  phase: "prepare",
  family: "DataStreams",
  description: "Get stream",
  safety: "read",
  requiredParams: ["dataStreamId"],
  optionalParams: [],
  capability: "d360_datastream_get",
  endpoint: { method: "GET", path: "/ssot/data-streams/{dataStreamId}" },
};

const journeyAction: Data360V2ActionDefinition = {
  tool: "data360_orchestrate",
  action: "manifest.run",
  phase: "orchestrate",
  family: "Journey",
  description: "Run manifest",
  safety: "confirmed",
  requiredParams: ["manifestPath", "authSessionId"],
  optionalParams: [],
  implementation: { kind: "journey", name: "manifest.run" },
};

const dloActions: Data360V2ActionDefinition[] = [
  {
    tool: "data360_prepare",
    action: "dlo.create",
    phase: "prepare",
    family: "DLO",
    description: "Create DLO",
    safety: "confirmed",
    requiredParams: ["body"],
    optionalParams: ["dataspace"],
    capability: "d360_dlo_create",
    endpoint: { method: "POST", path: "/ssot/data-lake-objects" },
  },
  {
    tool: "data360_prepare",
    action: "dlo.get",
    phase: "prepare",
    family: "DLO",
    description: "Get DLO",
    safety: "read",
    requiredParams: ["dloName"],
    optionalParams: [],
    capability: "d360_dlo_get",
    endpoint: { method: "GET", path: "/ssot/data-lake-objects/{dloName}" },
  },
  {
    tool: "data360_prepare",
    action: "dlo.delete",
    phase: "prepare",
    family: "DLO",
    description: "Delete DLO",
    safety: "destructive",
    requiredParams: ["dloName"],
    optionalParams: [],
    capability: "d360_dlo_delete",
    endpoint: { method: "DELETE", path: "/ssot/data-lake-objects/{dloName}" },
  },
];

describe("Data 360 v2 action sweep", () => {
  it("requires callers to select the target org explicitly", () => {
    expect(parseV2SweepArgs([]).targetOrg).toBe("");
    expect(parseV2SweepArgs(["--target-org", "example-data360"]).targetOrg).toBe("example-data360");
  });

  it("plans describe, metadata, dry-run, missing-param, and live-read checks", () => {
    const plan = buildV2SweepPlan([restAction, journeyAction], { liveRead: true });

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "describe",
          tool: "data360_prepare",
          action: "stream.get",
        }),
        expect.objectContaining({
          stage: "metadata",
          tool: "data360_prepare",
          action: "stream.get",
        }),
        expect.objectContaining({
          stage: "dry_run",
          tool: "data360_prepare",
          action: "stream.get",
        }),
        expect.objectContaining({
          stage: "missing_params",
          tool: "data360_prepare",
          action: "stream.get",
        }),
        expect.objectContaining({
          stage: "live_read",
          tool: "data360_prepare",
          action: "stream.get",
          outcome: "skipped",
        }),
        expect.objectContaining({
          stage: "dry_run",
          tool: "data360_orchestrate",
          action: "manifest.run",
          outcome: "skipped",
        }),
      ]),
    );
  });

  it("builds placeholder params for dry-run request resolution", () => {
    expect(paramsForDryRun(restAction)).toEqual({ dataStreamId: "PlaceholderDataStreamId" });
  });

  it("builds public-safe live-read params only when possible", () => {
    expect(paramsForLiveRead(restAction)).toBeUndefined();
    expect(paramsForLiveRead({ ...restAction, action: "stream.list", requiredParams: [] })).toEqual(
      {},
    );
  });

  it("skips fixture-dependent journey dry-runs", () => {
    expect(canDryRun(restAction)).toBe(true);
    expect(canDryRun(journeyAction)).toBe(false);
  });

  it("classifies live-read optional surface outcomes without failing", () => {
    expect(
      classifyLiveReadResult(restActionRecord(), {
        ok: false,
        response: { errorCode: "NOT_FOUND" },
        summary: "not found",
      }),
    ).toEqual(expect.objectContaining({ outcome: "not_found_optional", fail: false }));
    expect(
      classifyLiveReadResult(restActionRecord(), { ok: true, response: { dataStreams: [] } }),
    ).toEqual(expect.objectContaining({ outcome: "empty", fail: false }));
  });

  it("accepts useful missing-param errors", () => {
    expect(
      classifyUsefulMissingParamResult(new Error("Missing required parameter 'body'.")),
    ).toEqual(expect.objectContaining({ ok: true }));
    expect(
      classifyUsefulMissingParamResult({
        ok: false,
        error: "UNKNOWN_ACTION",
        suggestion: "Try actions.search",
      }),
    ).toEqual(expect.objectContaining({ ok: true }));
  });

  it("builds the DLO lifecycle from v2 registry owners and exact sweep-owned names", () => {
    const plan = buildDloV2LifecyclePlan(dloActions, "20260811A");

    expect(plan.resourceName).toBe("PiV2SweepDlo_20260811A__dll");
    expect(plan.checks.map(({ stage, tool, action }) => ({ stage, tool, action }))).toEqual([
      { stage: "lifecycle_preflight", tool: "data360_prepare", action: "dlo.get" },
      { stage: "lifecycle_plan", tool: "data360_prepare", action: "dlo.create" },
      { stage: "lifecycle_execute", tool: "data360_prepare", action: "dlo.create" },
      { stage: "lifecycle_verify", tool: "data360_prepare", action: "dlo.get" },
      { stage: "cleanup_plan", tool: "data360_prepare", action: "dlo.delete" },
      { stage: "cleanup_execute", tool: "data360_prepare", action: "dlo.delete" },
      { stage: "cleanup_verify", tool: "data360_prepare", action: "dlo.get" },
    ]);
    expect(plan.checks[1]).toMatchObject({ dryRun: true, safety: "confirmed" });
    expect(plan.checks[2]).toMatchObject({ allowConfirmed: true, safety: "confirmed" });
    expect(plan.checks[5]).toMatchObject({ allowConfirmed: true, safety: "destructive" });
  });

  it("requires exact non-production mutation gates and a stable run id", () => {
    const valid = {
      mutate: true,
      targetOrg: "ExampleSandbox",
      authenticatedTargets: ["ExampleSandbox"],
      orgType: "sandbox" as const,
      runId: "20260811A",
      mutationTargetOrg: "ExampleSandbox",
      destructiveTargetOrg: "ExampleSandbox",
    };

    expect(canRunV2MutationLifecycle(valid)).toEqual({ ok: true });
    expect(canRunV2MutationLifecycle({ ...valid, orgType: "developer" })).toEqual({ ok: true });
    expect(canRunV2MutationLifecycle({ ...valid, mutate: false })).toMatchObject({ ok: false });
    expect(
      canRunV2MutationLifecycle({ ...valid, destructiveTargetOrg: "OtherSandbox" }),
    ).toMatchObject({ ok: false });
    expect(canRunV2MutationLifecycle({ ...valid, orgType: "production" })).toMatchObject({
      ok: false,
    });
    expect(canRunV2MutationLifecycle({ ...valid, runId: "short" })).toMatchObject({ ok: false });
  });

  it("executes the confirmed lifecycle through v2 inputs and always reaches cleanup", async () => {
    const plan = buildDloV2LifecyclePlan(dloActions, "20260811B");
    const inputs: Data360V2Input[] = [];
    let getCount = 0;
    const records = await runV2LifecyclePlan(plan, async (input) => {
      inputs.push(input);
      if (input.action === "dlo.get") {
        getCount++;
        if (getCount === 1 || getCount === 3) {
          return { ok: false, response: { errorCode: "NOT_FOUND" }, summary: "not found" };
        }
        throw new Error("verification transport failed");
      }
      if (input.action === "dlo.create" && !input.dry_run) {
        return {
          ok: true,
          summary: "dlo.create ok",
          sweepPresentation: {
            text: "Data 360 create digest",
            artifacts: [{ label: "Raw result", path: "/tmp/example.json", kind: "json" }],
          },
        };
      }
      return { ok: true, summary: `${input.action} ok` };
    });

    expect(inputs).toEqual([
      { tool: "data360_prepare", action: "dlo.get", params: plan.checks[0]!.params },
      {
        tool: "data360_prepare",
        action: "dlo.create",
        params: plan.checks[1]!.params,
        dry_run: true,
      },
      {
        tool: "data360_prepare",
        action: "dlo.create",
        params: plan.checks[2]!.params,
        allow_confirmed: true,
      },
      { tool: "data360_prepare", action: "dlo.get", params: plan.checks[3]!.params },
      {
        tool: "data360_prepare",
        action: "dlo.delete",
        params: plan.checks[4]!.params,
        dry_run: true,
      },
      {
        tool: "data360_prepare",
        action: "dlo.delete",
        params: plan.checks[5]!.params,
        allow_confirmed: true,
      },
      { tool: "data360_prepare", action: "dlo.get", params: plan.checks[6]!.params },
    ]);
    expect(records.find((record) => record.stage === "lifecycle_execute")).toMatchObject({
      presentation: "Data 360 create digest",
      artifacts: [{ label: "Raw result", path: "/tmp/example.json", kind: "json" }],
    });
    expect(records.find((record) => record.stage === "lifecycle_verify")).toMatchObject({
      outcome: "failed",
      fail: true,
    });
    expect(records.at(-1)).toMatchObject({
      stage: "cleanup_verify",
      outcome: "cleaned",
      fail: false,
    });
  });

  it("retries sweep-owned cleanup after a transient platform rejection", async () => {
    const plan = buildDloV2LifecyclePlan(dloActions, "20260811C");
    const wait = vi.fn().mockResolvedValue(undefined);
    let getCount = 0;
    let deleteCount = 0;
    const records = await runV2LifecyclePlan(
      plan,
      async (input) => {
        if (input.action === "dlo.get") {
          getCount++;
          if (getCount === 2 || getCount === 3) {
            return { ok: true, response: { name: plan.resourceName } };
          }
          return { ok: false, status: 404, summary: "not found" };
        }
        if (input.action === "dlo.delete" && !input.dry_run) {
          deleteCount++;
          return deleteCount === 1
            ? { ok: false, status: 400, summary: "resource is not ready for deletion" }
            : { ok: true, status: 204 };
        }
        return { ok: true };
      },
      { cleanupAttempts: 2, cleanupVerifyAttempts: 2, retryDelayMs: 1, wait },
    );

    expect(deleteCount).toBe(2);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(records.find((record) => record.stage === "cleanup_execute")).toMatchObject({
      outcome: "cleaned",
      fail: false,
      summary: "Destructive cleanup completed after 2 attempts.",
    });
    expect(records.find((record) => record.stage === "cleanup_verify")).toMatchObject({
      outcome: "cleaned",
      fail: false,
      summary: "Sweep-owned resource cleanup verified after 2 attempts.",
    });
  });

  it("does not execute a mutation when its dry-run plan fails", async () => {
    const plan = buildDloV2LifecyclePlan(dloActions, "20260811C");
    const inputs: Data360V2Input[] = [];
    const records = await runV2LifecyclePlan(plan, async (input) => {
      inputs.push(input);
      if (input.action === "dlo.get") {
        return { ok: false, status: 404, summary: "not found" };
      }
      return { ok: false, summary: "dry-run rejected" };
    });

    expect(inputs.map((input) => `${input.action}:${Boolean(input.dry_run)}`)).toEqual([
      "dlo.get:false",
      "dlo.create:true",
    ]);
    expect(records.at(-1)).toMatchObject({ stage: "lifecycle_plan", fail: true });
  });

  it("parses the explicit mutation lifecycle flags", () => {
    expect(
      parseV2SweepArgs([
        "--target-org",
        "ExampleSandbox",
        "--mutation-lifecycle",
        "dlo",
        "--mutate",
        "--run-id",
        "20260811C",
      ]),
    ).toMatchObject({
      targetOrg: "ExampleSandbox",
      mutationLifecycle: "dlo",
      mutate: true,
      runId: "20260811C",
    });
  });
});

function restActionRecord() {
  return {
    stage: "live_read" as const,
    tool: restAction.tool,
    action: restAction.action,
    capability: restAction.capability,
    safety: restAction.safety,
    outcome: "ok" as const,
    fail: false,
    summary: "planned",
  };
}

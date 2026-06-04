/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildV2SweepPlan,
  canDryRun,
  classifyLiveReadResult,
  classifyUsefulMissingParamResult,
  paramsForDryRun,
  paramsForLiveRead,
} from "../../../scripts/e2e/data360-v2-action-sweep.ts";
import type { Data360V2ActionDefinition } from "../lib/v2/action-types.ts";

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

describe("Data 360 v2 action sweep", () => {
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

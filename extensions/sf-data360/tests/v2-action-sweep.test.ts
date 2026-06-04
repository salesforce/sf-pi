/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildV2SweepPlan,
  canDryRun,
  classifyUsefulMissingParamResult,
  paramsForDryRun,
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
  it("plans describe, metadata, dry-run, and missing-param checks", () => {
    const plan = buildV2SweepPlan([restAction, journeyAction]);

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

  it("skips fixture-dependent journey dry-runs", () => {
    expect(canDryRun(restAction)).toBe(true);
    expect(canDryRun(journeyAction)).toBe(false);
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

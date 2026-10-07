/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import {
  evaluateDestructiveExecutionGuard,
  shouldBlockMutation,
} from "../lib/destructive-guard.ts";
import { resolveDestructivePreflightRequest } from "../lib/operation-executor.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.0.0" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "ExampleSandbox", location: "Global" },
  org: {
    detected: true,
    alias: "ExampleSandbox",
    username: "user@example.invalid",
    orgType: "sandbox",
  },
  detectedAt: 1,
};
const destructive = { name: "d360_dlo_delete", safety: "destructive" as const };

describe("sf_data360 mutation and destructive guards", () => {
  it("allows reads and dry-runs but requires allow_mutation for writes", () => {
    expect(shouldBlockMutation({}, { safety: "read" })).toBe(false);
    expect(shouldBlockMutation({ dry_run: true }, { safety: "destructive" })).toBe(false);
    expect(shouldBlockMutation({}, { safety: "confirmed" })).toBe(true);
    expect(shouldBlockMutation({ allow_mutation: true }, { safety: "confirmed" })).toBe(false);
  });

  it("allows interactive destructive work only on a resolved non-production target", () => {
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructive,
        targetOrg: "ExampleSandbox",
        env,
        targetOrgInfo: { alias: "ExampleSandbox", orgType: "sandbox" },
        targetResolved: true,
        hasUI: true,
      }),
    ).toEqual({ blocked: false });
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructive,
        targetOrg: "ExampleProduction",
        env,
        targetOrgInfo: { alias: "ExampleProduction", orgType: "production" },
        targetResolved: true,
        hasUI: true,
      }),
    ).toMatchObject({ blocked: true });
  });

  it("allows headless deletion only for the exact sweep-owned DLO", () => {
    const ownedSweepCleanup = {
      runId: "20260811A",
      mutationTargetOrg: "ExampleSandbox",
      destructiveTargetOrg: "ExampleSandbox",
    };
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructive,
        targetOrg: "ExampleSandbox",
        env,
        targetOrgInfo: { alias: "ExampleSandbox", orgType: "sandbox" },
        targetResolved: true,
        hasUI: false,
        params: { dloName: "PiData360SweepDlo_20260811A__dll" },
        ownedSweepCleanup,
      }),
    ).toEqual({ blocked: false });
  });

  it("resolves read preflights for destructive endpoints", () => {
    expect(
      resolveDestructivePreflightRequest("d360_dmo_delete", { dmoName: "Example__dlm" }),
    ).toEqual({ path: "/ssot/data-model-objects/Example__dlm" });
    expect(
      resolveDestructivePreflightRequest("d360_ml_configured_model_delete", {
        idOrName: "ExampleConfiguredModel",
      }),
    ).toEqual({ path: "/ssot/machine-learning/configured-models/ExampleConfiguredModel" });
  });
});

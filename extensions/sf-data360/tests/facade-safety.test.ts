/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  evaluateDestructiveExecutionGuard,
  isAgentforceStdmTarget,
  resolveDestructivePreflightRequest,
  shouldBlockConfirmedOperation,
} from "../lib/facade-tool.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

const baseEnv: SfEnvironment = {
  cli: { installed: true, version: "2.0.0" },
  project: { detected: true, sourceApiVersion: "66.0" },
  config: { hasTargetOrg: true, targetOrg: "OtherOrg", location: "Global" },
  org: { detected: true, alias: "OtherOrg", username: "other@example.test", orgType: "sandbox" },
  detectedAt: 1,
};

const destructiveOperation = { name: "d360_dmo_delete", safety: "destructive" as const };

describe("d360 facade confirmed-operation guard", () => {
  it("allows read and safe_post operations without explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({}, { safety: "read" })).toBe(false);
    expect(shouldBlockConfirmedOperation({}, { safety: "safe_post" })).toBe(false);
  });

  it("allows confirmed/destructive operations when dry-run resolves the request", () => {
    expect(shouldBlockConfirmedOperation({ dry_run: true }, { safety: "confirmed" })).toBe(false);
    expect(shouldBlockConfirmedOperation({ dry_run: true }, { safety: "destructive" })).toBe(false);
  });

  it("blocks confirmed/destructive operations without explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({}, { safety: "confirmed" })).toBe(true);
    expect(shouldBlockConfirmedOperation({ allow_confirmed: false }, { safety: "confirmed" })).toBe(
      true,
    );
    expect(shouldBlockConfirmedOperation({}, { safety: "destructive" })).toBe(true);
  });

  it("allows confirmed/destructive operations only after explicit acknowledgement", () => {
    expect(shouldBlockConfirmedOperation({ allow_confirmed: true }, { safety: "confirmed" })).toBe(
      false,
    );
    expect(
      shouldBlockConfirmedOperation({ allow_confirmed: true }, { safety: "destructive" }),
    ).toBe(false);
  });

  it("recognizes the AgentforceSTDM target by explicit alias or detected alias", () => {
    expect(isAgentforceStdmTarget("AgentforceSTDM", baseEnv)).toBe(true);
    expect(
      isAgentforceStdmTarget("agentforce@example.test", baseEnv, {
        detected: true,
        alias: "AgentforceSTDM",
        username: "agentforce@example.test",
        orgType: "sandbox",
      }),
    ).toBe(true);
    expect(isAgentforceStdmTarget("OtherOrg", baseEnv)).toBe(false);
  });

  it("blocks destructive execution outside AgentforceSTDM", () => {
    const result = evaluateDestructiveExecutionGuard({
      operation: destructiveOperation,
      targetOrg: "OtherOrg",
      env: baseEnv,
      hasUI: true,
    });

    expect(result).toMatchObject({
      blocked: true,
      summary: "d360_dmo_delete requires target_org=AgentforceSTDM",
    });
  });

  it("blocks destructive execution without UI even for AgentforceSTDM", () => {
    const result = evaluateDestructiveExecutionGuard({
      operation: destructiveOperation,
      targetOrg: "AgentforceSTDM",
      env: baseEnv,
      hasUI: false,
    });

    expect(result).toMatchObject({
      blocked: true,
      summary: "d360_dmo_delete requires interactive confirmation",
    });
  });

  it("allows destructive execution only when target and UI guardrails are satisfied", () => {
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructiveOperation,
        targetOrg: "AgentforceSTDM",
        env: baseEnv,
        hasUI: true,
      }),
    ).toEqual({ blocked: false });
  });

  it("allows interactive v2 cleanup against a verified non-production target", () => {
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructiveOperation,
        executionSurface: "v2",
        targetOrg: "OtherOrg",
        env: baseEnv,
        targetOrgInfo: { alias: "OtherOrg", orgType: "sandbox" },
        hasUI: true,
      }),
    ).toEqual({ blocked: false });
  });

  it("allows interactive v2 cleanup against a verified developer org", () => {
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructiveOperation,
        executionSurface: "v2",
        targetOrg: "ExampleDeveloperOrg",
        env: baseEnv,
        targetOrgInfo: { alias: "ExampleDeveloperOrg", orgType: "developer" },
        hasUI: true,
      }),
    ).toEqual({ blocked: false });
  });

  it("accepts a target resolved by the shared connection when no alias is available", () => {
    expect(
      evaluateDestructiveExecutionGuard({
        operation: destructiveOperation,
        executionSurface: "v2",
        targetOrg: "ExplicitDeveloperTarget",
        targetResolved: true,
        env: baseEnv,
        targetOrgInfo: { orgType: "developer" },
        hasUI: true,
      }),
    ).toEqual({ blocked: false });
  });

  it("blocks v2 destructive execution against production or unresolved targets", () => {
    for (const orgType of ["production", "unknown"] as const) {
      expect(
        evaluateDestructiveExecutionGuard({
          operation: destructiveOperation,
          executionSurface: "v2",
          targetOrg: "ExampleOrg",
          env: baseEnv,
          targetOrgInfo: { alias: "ExampleOrg", orgType },
          hasUI: true,
        }),
      ).toMatchObject({
        blocked: true,
        summary: "d360_dmo_delete requires a verified non-production org",
      });
    }
  });

  it("allows headless v2 cleanup only for the exact gated sweep-owned DLO", () => {
    const sweep = {
      runId: "20260811A",
      mutationTargetOrg: "OtherOrg",
      destructiveTargetOrg: "OtherOrg",
    };
    expect(
      evaluateDestructiveExecutionGuard({
        operation: { name: "d360_dlo_delete", safety: "destructive" },
        executionSurface: "v2",
        targetOrg: "OtherOrg",
        env: baseEnv,
        targetOrgInfo: { alias: "OtherOrg", orgType: "sandbox" },
        hasUI: false,
        params: { dloName: "PiV2SweepDlo_20260811A__dll" },
        ownedSweepCleanup: sweep,
      }),
    ).toEqual({ blocked: false });
    expect(
      evaluateDestructiveExecutionGuard({
        operation: { name: "d360_dlo_delete", safety: "destructive" },
        executionSurface: "v2",
        targetOrg: "OtherOrg",
        env: baseEnv,
        targetOrgInfo: { alias: "OtherOrg", orgType: "sandbox" },
        hasUI: false,
        params: { dloName: "ExistingBusinessDlo__dll" },
        ownedSweepCleanup: sweep,
      }),
    ).toMatchObject({
      blocked: true,
      summary: "d360_dlo_delete requires interactive confirmation",
    });
  });

  it("resolves read preflights for new ML and personalization destructive operations", () => {
    expect(
      resolveDestructivePreflightRequest("d360_prediction_job_def_delete", {
        idOrName: "ExamplePrediction",
      }),
    ).toEqual({ path: "/ssot/machine-learning/prediction-job-definitions/ExamplePrediction" });
    expect(
      resolveDestructivePreflightRequest("d360_ml_configured_model_delete", {
        idOrName: "ExampleConfiguredModel",
      }),
    ).toEqual({ path: "/ssot/machine-learning/configured-models/ExampleConfiguredModel" });
    expect(
      resolveDestructivePreflightRequest("d360_p13n_experience_config_delete", {
        idOrAppSourceIdOrName: "ExampleConnector",
        nameParam: "ExampleExperience",
      }),
    ).toEqual({
      path: "/personalization/external-apps/ExampleConnector/personalization-experience-configs/ExampleExperience",
    });
    expect(
      resolveDestructivePreflightRequest("d360_p13n_transformer_delete", {
        idOrName: "ExampleTransformer",
      }),
    ).toEqual({
      path: "/personalization/external-apps/transformer",
      query: { idOrName: "ExampleTransformer" },
    });
  });

  it("resolves read preflights for destructive operations with clear GET counterparts", () => {
    expect(
      resolveDestructivePreflightRequest("d360_dmo_delete", { dmoName: "Example__dlm" }),
    ).toEqual({ path: "/ssot/data-model-objects/Example__dlm" });
    expect(
      resolveDestructivePreflightRequest("d360_connection_delete", {
        connectionId: "abc 123",
        connectorType: "SNOWFLAKE",
      }),
    ).toEqual({
      path: "/ssot/connections/abc%20123",
      query: { connectorType: "SNOWFLAKE" },
    });
  });
});

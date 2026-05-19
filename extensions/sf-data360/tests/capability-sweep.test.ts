/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildCapabilitySweepPlan,
  buildDynamicFollowUpChecks,
  classifySweepResult,
  containsPlaceholderValue,
  paramsForDryRun,
  paramsForLiveCheck,
} from "../../../scripts/e2e/d360-capability-sweep.ts";
import type { D360Capability } from "../lib/facade/registry.ts";

const listCapability: D360Capability = {
  name: "d360_data_spaces_list",
  kind: "rest_operation",
  family: "Dataspace",
  phase: "orchestrate",
  description: "List data spaces.",
  safety: "read",
  operation: {
    name: "d360_data_spaces_list",
    family: "Dataspace",
    description: "List data spaces.",
    method: "GET",
    path: "/ssot/data-spaces",
    safety: "read",
  },
};

const destructiveCapability: D360Capability = {
  name: "d360_dmo_delete",
  kind: "rest_operation",
  family: "DMO",
  phase: "harmonize",
  description: "Delete a DMO.",
  safety: "destructive",
  requiredParams: ["dmoName"],
  operation: {
    name: "d360_dmo_delete",
    family: "DMO",
    description: "Delete a DMO.",
    method: "DELETE",
    path: "/ssot/data-model-objects/{dmoName}",
    safety: "destructive",
    requiredParams: ["dmoName"],
  },
};

const streamDetailCapability: D360Capability = {
  name: "d360_datastream_get",
  kind: "rest_operation",
  family: "DataStreams",
  phase: "prepare",
  description: "Get a data stream.",
  safety: "read",
  requiredParams: ["dataStreamId"],
  operation: {
    name: "d360_datastream_get",
    family: "DataStreams",
    description: "Get a data stream.",
    method: "GET",
    path: "/ssot/data-streams/{dataStreamId}",
    safety: "read",
    requiredParams: ["dataStreamId"],
  },
};

const safePostCapability: D360Capability = {
  name: "d360_query_sql",
  kind: "rest_operation",
  family: "Query",
  phase: "retrieve",
  description: "Run SQL.",
  safety: "safe_post",
  requiredParams: ["sql"],
  operation: {
    name: "d360_query_sql",
    family: "Query",
    description: "Run SQL.",
    method: "POST",
    path: "/ssot/query-sql",
    safety: "safe_post",
    requiredParams: ["sql"],
  },
};

describe("d360 capability sweep planning", () => {
  it("plans dry-run coverage for every capability and live checks only for read/safe-post capabilities", () => {
    const plan = buildCapabilitySweepPlan(
      [listCapability, destructiveCapability, safePostCapability],
      {
        targetOrg: "AgentforceSTDM",
        live: true,
      },
    );

    expect(
      plan.filter((check) => check.stage === "dry_run").map((check) => check.capability),
    ).toEqual(["d360_data_spaces_list", "d360_dmo_delete", "d360_query_sql"]);
    expect(plan.filter((check) => check.stage === "live").map((check) => check.capability)).toEqual(
      ["d360_data_spaces_list", "d360_query_sql"],
    );
  });

  it("waits for dynamic list results instead of marking known detail capabilities as skipped", () => {
    const plan = buildCapabilitySweepPlan(
      [
        {
          ...listCapability,
          name: "d360_data_streams_list",
          family: "DataStreams",
        },
        streamDetailCapability,
      ],
      {
        targetOrg: "AgentforceSTDM",
        live: true,
      },
    );

    expect(plan.map((check) => `${check.stage}:${check.capability}`)).toEqual([
      "dry_run:d360_data_streams_list",
      "live:d360_data_streams_list",
      "dry_run:d360_datastream_get",
    ]);
  });

  it("builds dynamic detail checks from list responses", () => {
    const followUps = buildDynamicFollowUpChecks(
      {
        stage: "live",
        capability: "d360_data_streams_list",
        family: "DataStreams",
        safety: "read",
      },
      {
        ok: true,
        response: {
          dataStreams: [{ id: "stream-1", name: "StreamOne" }],
        },
      },
      [streamDetailCapability],
    );

    expect(followUps).toEqual([
      expect.objectContaining({
        stage: "live",
        capability: "d360_datastream_get",
        params: { dataStreamId: "stream-1" },
        sourceCapability: "d360_data_streams_list",
      }),
    ]);
  });

  it("builds placeholder params for dry-run request resolution without using them for live checks", () => {
    expect(paramsForDryRun(destructiveCapability)).toEqual({ dmoName: "SweepDryRunDmoName" });
    expect(paramsForLiveCheck(destructiveCapability)).toBeUndefined();
    expect(paramsForLiveCheck(safePostCapability)).toMatchObject({
      sql: expect.stringContaining("COUNT(*)"),
    });
  });

  it("detects placeholder payloads before live execution", () => {
    expect(containsPlaceholderValue({ body: { apiName: "Example_Score__cio" } })).toBe(true);
    expect(containsPlaceholderValue({ limit: 5, query: "AI Agent Interaction" })).toBe(false);
  });

  it("classifies live outcomes without failing on expected org-state limitations", () => {
    expect(
      classifySweepResult({ stage: "dry_run", capability: "d360_dmo_delete" }, { ok: true }),
    ).toMatchObject({ outcome: "dry_run_ok", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_search_index_list" },
        { ok: false, status: 404, error: "NOT_FOUND" },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_dlo_describe" },
        {
          ok: false,
          status: 500,
          error:
            "Please provide a valid recordId of type DataLakeObjectInstance or a valid developerName for a Data Lake Object.",
        },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_data_spaces_list" },
        { ok: false, error: "Cannot read properties of undefined" },
      ),
    ).toMatchObject({ outcome: "failed", fail: true });
  });
});

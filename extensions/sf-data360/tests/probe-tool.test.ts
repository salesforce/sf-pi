/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { classifyConnectionProbeResult, summarizeReadiness } from "../lib/probe-tool.ts";

describe("sf-data360 readiness probe", () => {
  it("classifies populated and empty list responses", () => {
    expect(
      classifyConnectionProbeResult("data_spaces", "/ssot/data-spaces", 200, {
        dataSpaces: [{ name: "default" }],
        totalSize: 1,
      }),
    ).toMatchObject({ state: "enabled_populated", count: 1, countKind: "total" });

    expect(
      classifyConnectionProbeResult("dmo_catalog", "/ssot/data-model-objects?limit=1", 200, {
        dataModelObject: [],
      }),
    ).toMatchObject({ state: "enabled_empty", count: 0, countKind: "returned_rows" });
  });

  it("classifies feature gates and missing resources", () => {
    expect(
      classifyConnectionProbeResult("data_streams", "/ssot/data-streams?limit=1", 403, [
        {
          message:
            "This feature is not currently enabled for this user type or org: [CdpDataStreams]",
          errorCode: "FUNCTIONALITY_NOT_ENABLED",
        },
      ]),
    ).toMatchObject({ state: "feature_gated", featureCode: "CdpDataStreams" });

    expect(
      classifyConnectionProbeResult(
        "agent_platform_tracing_dlo",
        "/ssot/data-lake-objects/ObservabilitySpans__dll",
        403,
        [
          {
            message:
              "This feature is not currently enabled for this user type or org: [AgentPlatformTracing]",
            errorCode: "FUNCTIONALITY_NOT_ENABLED",
          },
        ],
      ),
    ).toMatchObject({ state: "feature_gated", featureCode: "AgentPlatformTracing" });

    expect(
      classifyConnectionProbeResult("search_indexes", "/ssot/search-indexes?limit=1", 404, [
        { errorCode: "NOT_FOUND", message: "The requested resource does not exist" },
      ]),
    ).toMatchObject({ state: "not_found" });

    expect(
      classifyConnectionProbeResult(
        "agent_platform_tracing_dlo",
        "/ssot/data-lake-objects/ObservabilitySpans__dll",
        404,
        [{ errorCode: "NOT_FOUND", message: "The requested resource does not exist" }],
      ),
    ).toMatchObject({ state: "not_found" });
  });

  it("classifies the Agent Platform Tracing DLO as populated when metadata is visible", () => {
    expect(
      classifyConnectionProbeResult(
        "agent_platform_tracing_dlo",
        "/ssot/data-lake-objects/ObservabilitySpans__dll",
        200,
        {
          dataLakeObjects: [
            {
              name: "ObservabilitySpans__dll",
              label: "ObservabilitySpans",
              status: "ACTIVE",
              totalRecords: 9550,
              fields: [{ name: "spanId__c" }],
            },
          ],
        },
      ),
    ).toMatchObject({ state: "enabled_populated", count: 1, countKind: "returned_rows" });
  });

  it("summarizes ready, partial, and blocked orgs", () => {
    expect(
      summarizeReadiness([
        { name: "data_spaces", path: "/ssot/data-spaces", state: "enabled_populated" },
        { name: "dmo_catalog", path: "/ssot/data-model-objects?limit=1", state: "enabled_empty" },
      ]).state,
    ).toBe("ready");

    expect(
      summarizeReadiness([
        { name: "dmo_catalog", path: "/ssot/data-model-objects?limit=1", state: "enabled_empty" },
        { name: "data_streams", path: "/ssot/data-streams?limit=1", state: "feature_gated" },
      ]).state,
    ).toBe("partial");

    expect(
      summarizeReadiness([
        { name: "data_spaces", path: "/ssot/data-spaces", state: "feature_gated" },
        { name: "dmo_catalog", path: "/ssot/data-model-objects?limit=1", state: "cli_error" },
      ]).state,
    ).toBe("blocked");
  });
});

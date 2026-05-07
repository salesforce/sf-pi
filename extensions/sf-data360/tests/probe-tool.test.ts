/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { classifyProbeResult, summarizeReadiness } from "../lib/probe-tool.ts";

describe("sf-data360 readiness probe", () => {
  it("classifies populated and empty list responses", () => {
    expect(
      classifyProbeResult(
        "data_spaces",
        "/ssot/data-spaces",
        0,
        JSON.stringify({ dataSpaces: [{ name: "default" }], totalSize: 1 }),
        "",
      ),
    ).toMatchObject({ state: "enabled_populated", count: 1, countKind: "total" });

    expect(
      classifyProbeResult(
        "dmo_catalog",
        "/ssot/data-model-objects?limit=1",
        0,
        JSON.stringify({ dataModelObject: [] }),
        "",
      ),
    ).toMatchObject({ state: "enabled_empty", count: 0, countKind: "returned_rows" });
  });

  it("classifies feature gates and missing resources", () => {
    expect(
      classifyProbeResult(
        "data_streams",
        "/ssot/data-streams?limit=1",
        1,
        JSON.stringify([
          {
            message:
              "This feature is not currently enabled for this user type or org: [CdpDataStreams]",
            errorCode: "FUNCTIONALITY_NOT_ENABLED",
          },
        ]),
        "",
      ),
    ).toMatchObject({ state: "feature_gated", featureCode: "CdpDataStreams" });

    expect(
      classifyProbeResult(
        "search_indexes",
        "/ssot/search-indexes?limit=1",
        1,
        JSON.stringify([
          { errorCode: "NOT_FOUND", message: "The requested resource does not exist" },
        ]),
        "",
      ),
    ).toMatchObject({ state: "not_found" });
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

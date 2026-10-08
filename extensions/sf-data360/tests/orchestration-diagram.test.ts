/* SPDX-License-Identifier: Apache-2.0 */
import { render } from "grok-mermaid";
import { describe, expect, it } from "vitest";
import {
  buildData360OrchestrationTrace,
  type Data360TraceRun,
} from "../lib/orchestration-diagram.ts";

function pageRun(offset: number): Data360TraceRun {
  const page = offset / 200 + 1;
  return {
    action: "harmonize.dmo.list",
    namespace: "harmonize",
    status: "pass",
    resources: 200,
    apiCalls: [
      {
        transport: "CONNECT",
        method: "GET",
        url: `https://example.my.salesforce.com/services/data/v68.0/ssot/data-model-objects?limit=200&offset=${offset}`,
        status: 200,
        outcome: "success",
        detail: "d360_dmo_list",
        pagination: {
          kind: "offset",
          label: `Page ${page} · items ${offset + 1}–${offset + 200} · batch size 200`,
          offset,
          limit: 200,
          page,
          start: offset + 1,
          end: offset + 200,
          returned: 200,
        },
      },
    ],
  };
}

describe("Data 360 orchestration diagrams", () => {
  it("projects observed offset calls into one business-module trace", () => {
    const trace = buildData360OrchestrationTrace([pageRun(0), pageRun(200), pageRun(400)]);

    expect(trace).toMatchObject({
      calls: 3,
      resources: 600,
      truncated: false,
      layout: "sequence",
    });
    expect(trace?.mermaid).toContain("flowchart TD");
    expect(trace?.mermaid).toContain(
      "HARMONIZE · DMO list · GET /ssot/data-model-objects · Page 1",
    );
    expect(trace?.mermaid).toContain(
      "HARMONIZE · DMO list · GET /ssot/data-model-objects · Page 2",
    );
    expect(trace?.mermaid).toContain(
      "HARMONIZE · DMO list · GET /ssot/data-model-objects · Page 3",
    );
    expect(trace?.mermaid).toContain("3 API calls · 600 resources");
    expect(trace?.mermaid).not.toContain("example.my.salesforce.com");
    const art = render(trace?.mermaid ?? "");
    expect(art?.warnings).toEqual([]);
    expect(art?.width).toBeLessThanOrEqual(80);
  });

  it("fans independent business-module calls out from the resolved goal", () => {
    const trace = buildData360OrchestrationTrace([
      {
        action: "connect.connector.list",
        namespace: "connect",
        status: "pass",
        resources: 223,
        apiCalls: [
          {
            transport: "CONNECT",
            method: "GET",
            url: "https://example.my.salesforce.com/services/data/v68.0/ssot/connectors",
            outcome: "success",
          },
        ],
      },
      {
        action: "activate.activation.list",
        namespace: "activate",
        status: "pass",
        resources: 0,
        apiCalls: [
          {
            transport: "CONNECT",
            method: "GET",
            url: "https://example.my.salesforce.com/services/data/v68.0/ssot/activations?limit=5&offset=0",
            outcome: "success",
          },
        ],
      },
      {
        action: "segment.list",
        namespace: "segment",
        status: "pass",
        resources: 0,
        apiCalls: [
          {
            transport: "CONNECT",
            method: "GET",
            url: "https://example.my.salesforce.com/services/data/v68.0/ssot/segments?limit=5&offset=0",
            outcome: "success",
          },
        ],
      },
    ]);

    expect(trace).toMatchObject({ calls: 3, resources: 223, layout: "fanout" });
    expect(trace?.mermaid).toContain("participant M1 as CONNECT");
    expect(trace?.mermaid).toContain("GET /ssot/connectors · 223 resources");
    expect(trace?.mermaid).toContain("GET /ssot/activations · no resources");
    expect(trace?.mermaid).toContain("GET /ssot/segments · no results");
    expect(trace?.mermaid).not.toContain("call1 --> call2");
    expect(trace?.mermaid).not.toContain("example.my.salesforce.com");
    const art = render(trace?.mermaid ?? "");
    expect(art?.warnings).toEqual([]);
    expect(art?.width).toBeLessThanOrEqual(80);
  });

  it("does not add noise for one straightforward API call", () => {
    expect(buildData360OrchestrationTrace([pageRun(0)])).toBeUndefined();
  });

  it("bounds large traces and reports aggregated calls", () => {
    const trace = buildData360OrchestrationTrace(
      Array.from({ length: 10 }, (_value, index) => pageRun(index * 200)),
    );

    expect(trace).toMatchObject({
      calls: 10,
      resources: 2000,
      truncated: true,
      layout: "sequence",
    });
    expect(trace?.mermaid).toContain("Pages 6–10 · GET /ssot/data-model-objects");
    expect(trace?.mermaid).not.toContain("5 more API calls");
  });
});

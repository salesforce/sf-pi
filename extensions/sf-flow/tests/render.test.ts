/* SPDX-License-Identifier: Apache-2.0 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderFlowResult } from "../lib/render.ts";
import type { FlowRunDigest, ToolResult } from "../lib/types.ts";

const theme = {
  fg: (_name: string, value: string) => value,
  bold: (value: string) => value,
} as never;

const digest: FlowRunDigest = {
  action: "flow.inspect",
  kind: "flow_inspection",
  status: "pass",
  icon: "🌊",
  title: "Flow Inspection",
  meta: ["sample.flow-meta.xml", "record-triggered"],
  rail: [{ kind: "Local", target: "XML → graph model", detail: "2 elements" }],
  sections: [
    {
      icon: "🧩",
      title: "Flow",
      rows: [{ icon: "⚡", label: "Trigger", value: "RecordBeforeSave" }],
    },
  ],
  topology: {
    mermaid:
      'flowchart TD\n    a(["Start"])\n    b["Assign a Very Long Flow Result Value"]\n    a --> b',
    nodes: 2,
    total_nodes: 2,
    edges: 1,
    truncated: false,
  },
  artifacts: [{ kind: "topology", path: "/tmp/sample.mmd" }],
  next_step: "Validate the Flow.",
};
const result: ToolResult = {
  content: [{ type: "text", text: "PASS: Flow Inspection" }],
  details: { ok: true, digest },
};

describe("SF Flow Result Card", () => {
  it("keeps Mermaid topology outside the Flow Result Card", () => {
    const component = renderFlowResult(result, { expanded: true }, theme);
    const output = component.render(120).join("\n");

    expect(output).toContain("Flow Inspection");
    expect(output).not.toContain("Flow Topology");
    expect(output).not.toContain("Start");
    expect(output).not.toContain("flowchart TD");
    expect(output).toContain("/tmp/sample.mmd");
  });

  it("compacts long metadata and uses hanging indentation for artifact paths", () => {
    const longResult: ToolResult = {
      ...result,
      details: {
        ok: true,
        digest: {
          ...digest,
          meta: ["workspace/extensions/sf-flow/tests/fixtures/Very_Long_Flow_Name.flow-meta.xml"],
          artifacts: [
            {
              kind: "topology",
              path: "/home/example/.pi/agent/sf-pi/sf-flow/topology/Very_Long_Flow_Name.flow-meta.xml.mmd",
            },
          ],
        },
      },
    };
    const output = renderFlowResult(longResult, { expanded: true }, theme).render(48);

    expect(output[0]).toContain("…/fixtures/Very_Long_Flo");
    expect(output.every((line) => visibleWidth(line) <= 48)).toBe(true);
    const artifactIndex = output.findIndex((line) => line.includes("📄 topology"));
    expect(artifactIndex).toBeGreaterThan(-1);
    expect(output[artifactIndex + 1]?.startsWith(" ")).toBe(true);
  });

  it("keeps a narrow card bounded without rendering topology", () => {
    const component = renderFlowResult(result, {}, theme);
    const output = component.render(20).join("\n");

    expect(output).not.toContain("Topology available");
    expect(output.split("\n").every((line) => visibleWidth(line) <= 20)).toBe(true);
  });
});

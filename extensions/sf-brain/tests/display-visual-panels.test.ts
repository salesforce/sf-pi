/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";

import { renderDisplayCapabilitiesReport } from "../lib/display-capabilities-panel.ts";
import { renderVisualResponseAuditReport } from "../lib/visual-response-panel.ts";
import type { VisualResponseAuditReport } from "../lib/visual-response-audit.ts";

describe("SF Brain display and visual diagnostic panels", () => {
  it("renders effective display settings within narrow Manager width", () => {
    const lines = renderDisplayCapabilitiesReport(
      {
        mermaid: true,
        mermaidMode: "streaming",
        emoji: true,
        glyphMode: "emoji",
        terminalProgram: "test-terminal",
        terminalColumns: 80,
        supportedMermaidForms: [
          "flowchart",
          "sequenceDiagram",
          "stateDiagram-v2",
          "erDiagram",
          "classDiagram",
        ],
      },
      48,
    );

    expect(lines.join("\n")).toContain("Mermaid mode");
    expect(Math.max(...lines.map(visibleWidth))).toBeLessThanOrEqual(48);
  });

  it("renders only aggregate visual audit facts", () => {
    const report: VisualResponseAuditReport = {
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      scope: {
        sessionsAvailable: 2,
        sessionsSelected: 2,
        maxSessions: 50,
        maxFileBytes: 20,
        maxTotalBytes: 100,
        terminalWidth: 80,
      },
      summary: {
        sessionsAudited: 2,
        sessionsSkippedForBounds: 0,
        sessionsSkippedForScope: 0,
        sessionsWithVisualInstruction: 2,
        finalResponses: 4,
        responsesWithMermaid: 2,
        responsesWithVisualIcons: 3,
        diagrams: 2,
        supported: 2,
        unsupported: 0,
        malformed: 0,
        withWarnings: 0,
        topLevel: 2,
        wouldRenderAtWidth: 2,
      },
      diagramKinds: {
        flowchart: 1,
        sequence: 1,
        state: 0,
        er: 0,
        class: 0,
        unsupported: 0,
      },
      width: { samples: 2, min: 20, median: 30, p90: 30, max: 30 },
      limitations: [],
    };

    const lines = renderVisualResponseAuditReport(report, 48);
    expect(lines.join("\n")).toContain("Total / renderable");
    expect(Math.max(...lines.map(visibleWidth))).toBeLessThanOrEqual(48);
  });
});

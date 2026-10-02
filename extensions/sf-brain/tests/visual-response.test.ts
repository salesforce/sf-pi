/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { analyzeVisualResponse, evaluateVisualResponseContract } from "../lib/visual-response.ts";

describe("visual response analysis", () => {
  it("accepts one supported, top-level, terminal-sized sequence diagram", () => {
    const markdown = [
      "Short explanation.",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  participant C as Customer",
      "  participant S as Store",
      "  participant P as Payment",
      "  C->>S: Place order",
      "  S->>P: Charge card",
      "  P-->>S: Confirmed",
      "```",
    ].join("\n");

    const analysis = analyzeVisualResponse(markdown, 80);

    expect(analysis.diagrams).toHaveLength(1);
    expect(analysis.diagrams[0]).toMatchObject({
      kind: "sequence",
      topLevel: true,
      supported: true,
      warnings: 0,
      renderableAtWidth: true,
    });
    expect(
      evaluateVisualResponseContract(
        {
          mermaid: "required",
          kind: "sequence",
          maxWidth: 80,
          maxDiagrams: 1,
          requireTopLevel: true,
          requireZeroWarnings: true,
        },
        markdown,
      ).passed,
    ).toBe(true);
  });

  it("rejects nested, unsupported, warned, and over-width diagrams", () => {
    const nested = "- Example\n\n  ```mermaid\n  flowchart TD\n    A-->B\n  ```";
    const unsupported = "```mermaid\ngantt\n  title Plan\n```";
    const warned = '```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n  "request" --> Resolve\n```';
    const wide = [
      "```mermaid",
      "flowchart LR",
      "  A[First component with a long label] --> B[Second component with a long label] --> C[Third component with a long label] --> D[Fourth component with a long label]",
      "```",
    ].join("\n");

    expect(analyzeVisualResponse(nested, 80).diagrams[0]?.topLevel).toBe(false);
    expect(analyzeVisualResponse(unsupported, 80).diagrams[0]).toMatchObject({
      supported: false,
      renderableAtWidth: false,
    });
    expect(analyzeVisualResponse(warned, 80).diagrams[0]).toMatchObject({
      warnings: 1,
      renderableAtWidth: false,
    });
    expect(analyzeVisualResponse(wide, 80).diagrams[0]).toMatchObject({
      supported: true,
      renderableAtWidth: false,
    });
  });

  it("proves when a response must not contain Mermaid", () => {
    const result = evaluateVisualResponseContract(
      { mermaid: "forbidden" },
      "✅ Three independent test suites passed. No connected process is being explained.",
    );

    expect(result.passed).toBe(true);
    expect(result.facts).toContain("No Mermaid diagram was present, as required.");
  });
});

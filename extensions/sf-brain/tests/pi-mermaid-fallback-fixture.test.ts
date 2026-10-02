/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeVisualResponse } from "../lib/visual-response.ts";

type Expected = "render" | "too_wide" | "unsupported" | "malformed" | "warning";
type Fixture = {
  id: string;
  available_width: number;
  source: string;
  expected: Expected;
};

const fixtures = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/pi-mermaid-fallback-cases.json"), "utf8"),
) as Fixture[];

describe("upstream Pi Mermaid fallback fixture", () => {
  it.each(fixtures)("classifies $id", (fixture) => {
    const response = `\`\`\`mermaid\n${fixture.source}\n\`\`\``;
    const diagram = analyzeVisualResponse(response, fixture.available_width).diagrams[0];
    const actual: Expected = !diagram?.supported
      ? "unsupported"
      : !diagram.syntaxValid
        ? "malformed"
        : diagram.warnings > 0
          ? "warning"
          : diagram.renderableAtWidth
            ? "render"
            : "too_wide";

    expect(actual).toBe(fixture.expected);
  });
});

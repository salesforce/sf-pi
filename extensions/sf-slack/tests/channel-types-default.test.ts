/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level guard: every `assistant.search.context` call site must include
 * `channel_types` so DMs + MPIMs are not silently dropped from search results.
 *
 * This is verified by pattern instead of at runtime because exercising each
 * call site would require spinning up the full pi runtime with live tool
 * invocations. A source-level check is cheap and catches regressions the
 * moment someone adds a new call site without the default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const libDir = path.resolve(fileURLToPath(import.meta.url), "../../lib");

function read(fileName: string): string {
  return readFileSync(path.join(libDir, fileName), "utf-8");
}

/** Extract the `params` object literal that precedes each
 *  `slackApiJson(...assistant.search.context...)` call. We only consider the
 *  actual API-call sites, not string-literal mentions (e.g. resolve.ts uses
 *  `strategy.push("assistant.search.context")` as a debug trail). */
function assistantParamLiterals(source: string): string[] {
  const literals: string[] = [];
  const re = /slackApiJson<[^>]*>\s*\(\s*"assistant\.search\.context"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const windowStart = Math.max(0, match.index - 800);
    literals.push(source.slice(windowStart, match.index));
  }
  return literals;
}

describe("channel_types default on assistant.search.context", () => {
  it("api.ts populates DEFAULT_ASSISTANT_CHANNEL_TYPES with DMs and MPIMs", () => {
    const api = read("api.ts");
    expect(api).toContain("DEFAULT_ASSISTANT_CHANNEL_TYPES");
    expect(api).toMatch(/DEFAULT_ASSISTANT_CHANNEL_TYPES\s*=\s*"[^"]*\bim\b[^"]*"/);
    expect(api).toMatch(/DEFAULT_ASSISTANT_CHANNEL_TYPES\s*=\s*"[^"]*mpim[^"]*"/);
  });

  for (const fileName of [
    "tools.ts",
    "research-tool.ts",
    "channel-tool.ts",
    "resolve.ts",
    "api.ts",
  ]) {
    it(`${fileName} references DEFAULT_ASSISTANT_CHANNEL_TYPES before every assistant.search.context call`, () => {
      const source = read(fileName);
      const windows = assistantParamLiterals(source);
      expect(windows.length).toBeGreaterThan(0);
      for (const window of windows) {
        expect(
          window,
          `assistant.search.context call in ${fileName} is missing channel_types default`,
        ).toContain("DEFAULT_ASSISTANT_CHANNEL_TYPES");
      }
    });
  }
});

/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { buildSlackTextResult, truncateSlackText } from "../lib/truncation.ts";

const tempDirs = new Set<string>();

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("truncateSlackText", () => {
  it("returns the original text when output fits within limits", async () => {
    const result = await truncateSlackText("hello\nworld");

    expect(result.text).toBe("hello\nworld");
    expect(result.truncation).toBeUndefined();
    expect(result.fullOutputPath).toBeUndefined();
  });

  it("truncates large output and saves the full text to a temp file", async () => {
    const fullText = Array.from({ length: 2105 }, (_, index) => `Line ${index + 1}`).join("\n");

    const result = await truncateSlackText(fullText, { prefix: "sf-slack-test" });

    expect(result.truncation?.truncated).toBe(true);
    expect(result.text).toContain("Output truncated");
    expect(result.fullOutputPath).toBeTruthy();
    expect(existsSync(result.fullOutputPath!)).toBe(true);
    expect(readFileSync(result.fullOutputPath!, "utf8")).toBe(fullText);

    tempDirs.add(dirname(result.fullOutputPath!));
  });
});

describe("buildSlackTextResult", () => {
  it("adds the shared sf-pi tool result envelope", async () => {
    const result = await buildSlackTextResult(
      "Found 2 messages",
      { ok: true, action: "search", count: 2 },
      { prefix: "sf-slack-test" },
    );

    expect(result.details.sfPi).toMatchObject({
      ok: true,
      action: "search",
      summary: "Found 2 messages",
    });
  });
});

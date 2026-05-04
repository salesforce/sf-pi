/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level guard for Pi 0.73 incremental bash streaming.
 *
 * Bash output can now stream while the command is running. sf-guardrail must
 * therefore keep enforcing in `tool_call`, before execution starts, not in a
 * post-result hook that would run after streamed side effects are already
 * visible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve("extensions/sf-guardrail/index.ts"), "utf8");

describe("sf-guardrail hook order", () => {
  it("enforces safety in tool_call before tools execute", () => {
    expect(source).toContain('pi.on("tool_call"');
    expect(source).toContain("classify({");
    expect(source).toContain("return { block: true");
    expect(source).not.toContain('pi.on("tool_result"');
  });
});

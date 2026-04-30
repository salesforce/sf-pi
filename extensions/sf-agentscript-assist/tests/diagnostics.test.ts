/* SPDX-License-Identifier: Apache-2.0 */
/**
 * End-to-end tests for the diagnostics layer.
 *
 * These hit the real vendored SDK so we prove:
 *  - the bundle is loadable
 *  - our filter + code-action layer produces the shapes we expect on real
 *    SDK output
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentScriptFile } from "../lib/diagnostics.ts";

function writeTempAgent(contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sf-agentscript-assist-"));
  const file = path.join(dir, "sample.agent");
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("checkAgentScriptFile (integration)", () => {
  it("returns ok with no diagnostics for a well-formed agent", async () => {
    // Shape cribbed from upstream compiler test fixtures — minimal, valid,
    // agentforce dialect by default.
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are a helpful assistant."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.dialect?.name).toBe("agentforce");
  });

  it("surfaces errors on a broken agent", async () => {
    const file = writeTempAgent(
      ["# @dialect: agentforce 2.5", "system:", '  instructions: "hi"', ""].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.severity === 1)).toBe(true);
  });

  it("includes unused-variable as a severity-2 actionable warning with a fix", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "variables:",
        '    case_id: mutable string = ""',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const unused = result.diagnostics.find((d) => d.code === "unused-variable");
    expect(unused, "expected unused-variable diagnostic").toBeDefined();

    const unusedFix = result.quickFixes.find((f) => f.diagnosticCode === "unused-variable");
    expect(unusedFix, "expected unused-variable fix").toBeDefined();
    expect(unusedFix?.edits[0].newText).toBe("");
  });
});

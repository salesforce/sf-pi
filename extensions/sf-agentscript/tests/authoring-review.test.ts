/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-review-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function captureAuthoringTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerAuthoringTool({ registerTool: (def: ToolDefinition) => (tool = def) } as never);
  if (!tool) throw new Error("agentscript_authoring was not registered");
  return tool;
}

function ctx(): ExtensionContext {
  return { cwd: workDir, sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext;
}

describe("agentscript_authoring inspect/review", () => {
  test("blocks files missing the system prompt block", async () => {
    const agentFile = path.join(workDir, "minimal.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    agent_name: "Minimal"',
        '    agent_type: "AgentforceEmployeeAgent"',
        "",
        "start_agent main:",
        '    description: "Minimal start agent"',
        "    reasoning:",
        "        instructions: ->",
        "            | Respond to the user",
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-1",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );

    const details = result.details as { readiness?: string; findings?: Array<{ id: string }> };
    expect(details.readiness).toBe("blocked");
    expect(details.findings?.map((finding) => finding.id)).toContain("missing-system-block");
  });
});

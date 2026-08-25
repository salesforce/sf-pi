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
  test("blocks review on High native quality findings while compile stays valid", async () => {
    const agentFile = path.join(workDir, "cycle.agent");
    await writeFile(
      agentFile,
      [
        "system:",
        '    instructions: "Help"',
        "    messages:",
        '        welcome: "Hi"',
        '        error: "Error"',
        "config:",
        '    agent_name: "Cycle"',
        '    agent_type: "AgentforceEmployeeAgent"',
        "start_agent main:",
        '    description: "Main"',
        "    before_reasoning:",
        "        transition to @subagent.a",
        "subagent a:",
        '    description: "A"',
        "    before_reasoning:",
        "        transition to @subagent.b",
        "subagent b:",
        '    description: "B"',
        "    before_reasoning:",
        "        transition to @subagent.a",
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-quality",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      readiness?: string;
      findings?: Array<{ id: string; category: string; message: string }>;
      quality?: { status: string };
    };
    expect(details.quality?.status).toBe("findings");
    expect(details.readiness).toBe("blocked");
    expect(details.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("unconditional-transition-cycle"),
          category: "quality",
        }),
      ]),
    );
    expect(
      details.findings?.find((finding) => finding.category === "quality")?.message,
    ).not.toMatch(/^Endless Transition Loop: Endless Transition Loop:/);
  });

  test("keeps instruction template syntax as a pre-activation warning", async () => {
    const agentFile = path.join(workDir, "instruction-syntax.agent");
    await writeFile(
      agentFile,
      [
        "system:",
        '    instructions: "Help"',
        "    messages:",
        '        welcome: "Hi"',
        '        error: "Error"',
        "config:",
        '    agent_name: "InstructionSyntax"',
        '    agent_type: "AgentforceEmployeeAgent"',
        "variables:",
        '    current_step: mutable string = "start"',
        '        description: "Current step"',
        "start_agent main:",
        '    description: "Main"',
        "    reasoning:",
        "        instructions: |",
        "            Use @variables.current_step to decide what to do next.",
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-instruction-syntax",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      readiness?: string;
      findings?: Array<{ id: string; severity: string }>;
    };
    expect(details.readiness).toBe("ready_with_warnings");
    expect(details.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("instruction-template-syntax"),
          severity: "warning",
        }),
      ]),
    );
  });

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

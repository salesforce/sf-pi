/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";
import { AGENT_SCRIPT_QUALITY_RULES } from "../lib/quality/catalog.ts";
import { validateAuthoringParams } from "../lib/authoring/params.ts";

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-quality-authoring-"));
});
afterEach(async () => rm(workDir, { recursive: true, force: true }));

function captureTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerAuthoringTool({
    registerTool: (definition: ToolDefinition) => (tool = definition),
  } as never);
  if (!tool) throw new Error("tool not registered");
  return tool;
}

function ctx(): ExtensionContext {
  return { cwd: workDir, sessionManager: { getBranch: () => [] } } as unknown as ExtensionContext;
}

const theme = {
  fg: (_color: string, value: string) => value,
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
} as Theme;

describe("agentscript_authoring inspect/quality", () => {
  it("is a valid read-only authoring mode", () => {
    expect(validateAuthoringParams({ verb: "inspect", mode: "quality" as never })).toMatchObject({
      ok: true,
      key: "inspect.quality",
    });
  });

  it("returns structured quality findings and coverage", async () => {
    const file = path.join(workDir, "Quality.agent");
    await writeFile(
      file,
      `system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "Quality"
    agent_type: "AgentforceEmployeeAgent"
start_agent main:
    description: "Main"
    actions:
        unused:
            description: "Unused"
            outputs:
                ok: string
            target: "flow://Unused"
`,
    );
    const tool = captureTool();
    const args = { verb: "inspect", mode: "quality", agent_file: file } as const;
    const result = await tool.execute("call-1", args, undefined, undefined, ctx());
    const details = result.details as {
      action?: string;
      quality?: {
        status?: string;
        coverage?: { total_rules?: number; enabled_rules?: number };
        findings?: Array<{ rule_id?: string }>;
      };
    };
    expect(details.action).toBe("inspect.quality");
    expect(details.quality?.status).toBe("findings");
    expect(details.quality?.coverage).toMatchObject({
      total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
      enabled_rules: AGENT_SCRIPT_QUALITY_RULES.length,
    });
    expect(details.quality?.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: "unused-action" })]),
    );

    const component = tool.renderResult?.(result as never, { expanded: true } as never, theme, {
      args,
    } as never);
    const rendered = component?.render(120).join("\n") ?? "";
    expect(rendered).toContain("Agent Script Quality");
    expect(rendered).toContain("Unused Action");
  });

  it("promotes upstream instruction template diagnostics into quality findings", async () => {
    const file = path.join(workDir, "InstructionSyntax.agent");
    await writeFile(
      file,
      `system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "InstructionSyntax"
    agent_type: "AgentforceEmployeeAgent"
variables:
    conversation_step: mutable string = "start"
        description: "Current step"
start_agent main:
    description: "Main"
    reasoning:
        instructions: |
            Use @variables.conversation_step to decide what to do next.
`,
    );

    const result = await captureTool().execute(
      "call-instruction-syntax",
      { verb: "inspect", mode: "quality", agent_file: file },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      quality?: { findings?: Array<{ rule_id?: string; severity?: string }> };
    };
    expect(details.quality?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "instruction-template-syntax",
          severity: "moderate",
        }),
      ]),
    );
  });
});

/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
import { registerLifecycleTool } from "../lib/lifecycle-tool.ts";
import { resetSessionQualityOverrides } from "../lib/quality/publication-gate.ts";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-lifecycle-quality-"));
  resetSessionQualityOverrides();
});
afterEach(async () => rm(cwd, { recursive: true, force: true }));

function captureTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerLifecycleTool({
    registerTool: (definition: ToolDefinition) => (tool = definition),
  } as never);
  if (!tool) throw new Error("lifecycle tool not registered");
  return tool;
}

function ctx() {
  return createToolTestContext({ cwd, sessionManager: { getBranch: () => [] } });
}

describe("lifecycle High quality gate", () => {
  it("returns structured card evidence before any org call", async () => {
    const file = path.join(cwd, "Gate.agent");
    await writeFile(
      file,
      `system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "Gate"
    agent_type: "AgentforceEmployeeAgent"
start_agent main:
    description: "Main"
    before_reasoning:
        transition to @subagent.a
subagent a:
    description: "A"
    before_reasoning:
        transition to @subagent.b
subagent b:
    description: "B"
    before_reasoning:
        transition to @subagent.a
`,
    );
    const result = await captureTool().execute(
      "gate",
      { action: "publish", agent_file: file, agent_api_name: "Gate" },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      ok?: boolean;
      action?: string;
      quality_gate?: {
        file?: string;
        risk_ids?: string[];
        quality?: { findings?: Array<{ rule_id?: string }> };
      };
      recover_via?: { params?: { acknowledge_quality_risk?: boolean } };
    };
    expect(details).toMatchObject({
      ok: false,
      action: "publish.quality_gate",
      quality_gate: {
        file,
        risk_ids: ["unconditional-transition-cycle"],
      },
      recover_via: { params: { acknowledge_quality_risk: true } },
    });
    expect(details.quality_gate?.quality?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule_id: "unconditional-transition-cycle" }),
      ]),
    );
  });

  it("stops overlong variable descriptions before any org call", async () => {
    const file = path.join(cwd, "DescriptionGate.agent");
    await writeFile(
      file,
      `system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "DescriptionGate"
    agent_type: "AgentforceEmployeeAgent"
variables:
    current_step: mutable string = "start"
        description: "${"a".repeat(256)}"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Help
`,
    );

    const result = await captureTool().execute(
      "description-gate",
      { action: "publish", agent_file: file, agent_api_name: "DescriptionGate" },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      action?: string;
      quality_gate?: { risk_ids?: string[] };
    };
    expect(details).toMatchObject({
      action: "publish.quality_gate",
      quality_gate: { risk_ids: ["variable-description-max-length"] },
    });
  });
});

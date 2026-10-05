/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
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

function ctx() {
  return createToolTestContext({
    cwd: workDir,
    sessionManager: { getBranch: () => [] },
  });
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

  test("reports voice-profile advisories without duplicating compiler diagnostics", async () => {
    const agentFile = path.join(workDir, "voice-review.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    developer_name: "VoiceReview"',
        '    agent_type: "AgentforceServiceAgent"',
        "    runtime:",
        "        streaming: False",
        "access:",
        '    default_agent_user: "agent@example.com"',
        "system:",
        '    instructions: "Keep spoken responses concise."',
        "    messages:",
        '        welcome: "Hello"',
        '        error: "Please try again."',
        "language:",
        '    default_locale: "en_US"',
        "modality voice:",
        "    outbound:",
        "        model:",
        '            id: "eleven_v3_conversational"',
        "            parameters:",
        "                similarity: 0.75",
        "start_agent main:",
        '    description: "Help the caller."',
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-voice-review",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      readiness?: string;
      findings?: Array<{ id: string; category: string; severity: string }>;
      voice_profile?: { syntax?: string };
    };

    expect(details.readiness).toBe("ready_with_warnings");
    expect(details.voice_profile).toMatchObject({ syntax: "nested" });
    expect(details.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "voice-streaming-disabled",
          category: "voice",
          severity: "warning",
        }),
        expect.objectContaining({
          id: "voice-v3-ignored-parameter",
          category: "voice",
          severity: "warning",
        }),
      ]),
    );
  });

  test("accepts a valid orchestrator-based GoalBasedAgent without start_agent", async () => {
    const agentFile = path.join(workDir, "goal-based.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    agent_name: "GoalBased"',
        '    agent_type: "GoalBasedAgent"',
        "system:",
        '    instructions: "Coordinate work."',
        "    messages:",
        '        welcome: "Hi"',
        '        error: "Error"',
        "orchestrator agent:",
        "    reasoning:",
        "        instructions: ->",
        "            | Coordinate the goal.",
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-goal-based",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as {
      readiness?: string;
      findings?: Array<{ id: string }>;
      quality?: { status: string; metrics?: { cyclomatic_complexity?: unknown[] } };
    };
    expect(details.readiness).toBe("ready");
    expect(details.quality?.status).toBe("clean");
    expect(details.findings?.map((finding) => finding.id)).not.toContain("missing-start-agent");
  });

  test("continues to block ordinary agents without start_agent", async () => {
    const agentFile = path.join(workDir, "ordinary-no-start.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    agent_name: "Ordinary"',
        '    agent_type: "AgentforceEmployeeAgent"',
        "system:",
        '    instructions: "Help."',
        "    messages:",
        '        welcome: "Hi"',
        '        error: "Error"',
        "subagent helper:",
        '    description: "Helper"',
        "",
      ].join("\n"),
    );

    const result = await captureAuthoringTool().execute(
      "call-ordinary-no-start",
      { verb: "inspect", mode: "review", agent_file: agentFile },
      undefined,
      undefined,
      ctx(),
    );
    const details = result.details as { readiness?: string; findings?: Array<{ id: string }> };
    expect(details.readiness).toBe("blocked");
    expect(details.findings?.map((finding) => finding.id)).toContain("missing-start-agent");
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

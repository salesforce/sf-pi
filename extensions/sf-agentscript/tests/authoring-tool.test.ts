/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";
import { validateAuthoringParams } from "../lib/authoring/params.ts";
import { AGENTSCRIPT_BRANCH_STATE_KEY } from "../lib/branch-state.ts";
import { createBundle } from "../lib/create.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-authoring-"));
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

function ctxWithBranch(branch: unknown[] = []) {
  return createToolTestContext({
    cwd: workDir,
    sessionManager: {
      getBranch: () => branch,
    },
  });
}

describe("agentscript_authoring", () => {
  test("inspect/runtime_smoke requires target_org", () => {
    expect(validateAuthoringParams({ verb: "inspect", mode: "runtime_smoke" })).toEqual({
      ok: false,
      error: "inspect.runtime_smoke requires: target_org.",
    });
    expect(
      validateAuthoringParams({ verb: "inspect", mode: "runtime_smoke", target_org: "dev" }),
    ).toMatchObject({ ok: true, key: "inspect.runtime_smoke" });
  });

  test("compile/check works through the family tool and emits branch state", async () => {
    const created = await createBundle({ cwd: workDir, bundle_name: "Authoring_Bot" });
    if (created.ok === false) throw new Error(created.reason_detail ?? created.reason);

    const tool = captureAuthoringTool();
    const result = await tool.execute(
      "call-1",
      { verb: "compile", mode: "check", agent_file: created.agent_path },
      undefined,
      undefined,
      ctxWithBranch(),
    );

    const details = result.details as Record<string, unknown>;
    expect(details.ok).toBe(true);
    expect(details.action).toBe("compile.check");
    expect(details.agent_file).toBe(created.agent_path);
    expect(details[AGENTSCRIPT_BRANCH_STATE_KEY]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent_file", agent_file: created.agent_path }),
        expect.objectContaining({ kind: "compile_result", agent_file: created.agent_path }),
      ]),
    );
  });

  test("compile/check exposes source-bound quick-fix identities", async () => {
    const agentFile = path.join(workDir, "identity.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    agent_name: "Identity_Bot"',
        "system:",
        '    instructions: "Help"',
        "variables:",
        '    unused: mutable string = "x"',
        '    used: mutable string = "y"',
        "start_agent main:",
        '    description: "Main"',
        "    reasoning:",
        "        instructions: |",
        "            Use {!@variables.used}.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await captureAuthoringTool().execute(
      "call-identities",
      { verb: "compile", mode: "check", agent_file: agentFile },
      undefined,
      undefined,
      ctxWithBranch(),
    );
    const details = result.details as {
      source_version?: string;
      diagnostics?: Array<{ diagnosticId?: string; code?: string }>;
      quick_fixes?: Array<{
        actionId?: string;
        diagnosticId?: string;
        sourceVersion?: string;
        apply_via?: { params?: Record<string, unknown> };
      }>;
      code_action_provider?: { status?: string };
    };
    const diagnostic = details.diagnostics?.find((item) => item.code === "unused-variable");
    const fix = details.quick_fixes?.[0];

    expect(details.source_version).toMatch(/^sv1:/);
    expect(diagnostic?.diagnosticId).toMatch(/^diag1:/);
    expect(fix).toMatchObject({
      actionId: expect.stringMatching(/^act1:/),
      diagnosticId: diagnostic?.diagnosticId,
      sourceVersion: details.source_version,
    });
    expect(fix?.apply_via?.params).toMatchObject({
      source_version: details.source_version,
      diagnostic_id: diagnostic?.diagnosticId,
      action_id: fix?.actionId,
    });
    expect(details.code_action_provider?.status).toBe("available");
  });

  test("inspect/context_profile surfaces nested voice configuration and advisories", async () => {
    const agentFile = path.join(workDir, "voice.agent");
    await writeFile(
      agentFile,
      [
        "config:",
        '    developer_name: "Voice_Bot"',
        '    agent_type: "AgentforceServiceAgent"',
        "    runtime:",
        "        streaming: False",
        "access:",
        '    default_agent_user: "agent@example.com"',
        "system:",
        '    instructions: "Keep spoken responses concise."',
        "actions:",
        "    lookup:",
        '        description: "Look up account details."',
        '        target: "flow://Lookup"',
        "        include_in_progress_indicator: True",
        "language:",
        '    default_locale: "en_US"',
        "modality voice:",
        "    inbound:",
        "        filler_words_detection: True",
        "    outbound:",
        "        model:",
        '            id: "eleven_v3_conversational"',
        "            parameters:",
        "                speed: 1.0",
        "        filler_sentences:",
        '            - "Let me check that."',
        "start_agent main:",
        '    description: "Route the call."',
        "    reasoning:",
        "        actions:",
        "            route: @utils.transition to @subagent.help",
        "subagent help:",
        '    description: "Help the caller."',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await captureAuthoringTool().execute(
      "call-voice-profile",
      { verb: "inspect", mode: "context_profile", agent_file: agentFile },
      undefined,
      undefined,
      ctxWithBranch(),
    );
    const details = result.details as {
      voice_profile?: {
        syntax?: string;
        streaming?: string;
        default_locale?: string;
        outbound?: { model_id?: string; filler_sentences?: string[] };
        inbound?: { filler_words_detection?: boolean };
        advisories?: Array<{ code?: string }>;
        actions?: { total?: number; with_progress_indicator?: number };
        router?: { name?: string; transition_only?: boolean };
      };
    };

    expect(details.voice_profile).toMatchObject({
      syntax: "nested",
      streaming: "disabled",
      default_locale: "en_US",
      outbound: {
        model_id: "eleven_v3_conversational",
        filler_sentences: ["Let me check that."],
      },
      inbound: { filler_words_detection: true },
      actions: { total: 1, with_progress_indicator: 1 },
      router: { name: "main", transition_only: true },
    });
    expect(details.voice_profile?.advisories?.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "voice-streaming-disabled",
        "voice-v3-ignored-parameter",
        "voice-router-hyperclassifier-candidate",
      ]),
    );
    const text = result.content.find((part) => part.type === "text")?.text;
    expect(text).toContain("voice: nested");
    expect(text).toContain("streaming=disabled");
  });

  test("compile/check infers agent_file from exactly one branch-state candidate", async () => {
    const created = await createBundle({ cwd: workDir, bundle_name: "Inferred_Bot" });
    if (created.ok === false) throw new Error(created.reason_detail ?? created.reason);

    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "agentscript_authoring",
          isError: false,
          details: {
            ok: true,
            [AGENTSCRIPT_BRANCH_STATE_KEY]: [
              { schema_version: 1, kind: "agent_file", agent_file: created.agent_path },
            ],
          },
        },
      },
    ];

    const tool = captureAuthoringTool();
    const result = await tool.execute(
      "call-1",
      { verb: "compile", mode: "check" },
      undefined,
      undefined,
      ctxWithBranch(branch),
    );

    const details = result.details as Record<string, unknown>;
    expect(details.ok).toBe(true);
    expect(details.agent_file).toBe(created.agent_path);
  });

  test("compile/check refuses ambiguous inferred agent_file candidates", async () => {
    const one = await createBundle({ cwd: workDir, bundle_name: "One_Bot" });
    const two = await createBundle({ cwd: workDir, bundle_name: "Two_Bot" });
    if (one.ok === false || two.ok === false) throw new Error("create failed");

    const branch = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "agentscript_authoring",
          isError: false,
          details: {
            ok: true,
            [AGENTSCRIPT_BRANCH_STATE_KEY]: [
              { schema_version: 1, kind: "agent_file", agent_file: one.agent_path },
              { schema_version: 1, kind: "agent_file", agent_file: two.agent_path },
            ],
          },
        },
      },
    ];

    const tool = captureAuthoringTool();
    const result = await tool.execute(
      "call-1",
      { verb: "compile", mode: "check" },
      undefined,
      undefined,
      ctxWithBranch(branch),
    );

    const details = result.details as Record<string, unknown>;
    expect(details.ok).toBe(false);
    expect(details.error).toMatch(/Multiple current \.agent files/);
    expect(details.candidates).toEqual([
      { agent_file: one.agent_path },
      { agent_file: two.agent_path },
    ]);
  });
});

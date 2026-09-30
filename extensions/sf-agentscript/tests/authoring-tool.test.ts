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

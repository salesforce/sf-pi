/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
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

function ctxWithBranch(branch: unknown[] = []): ExtensionContext {
  return {
    cwd: workDir,
    sessionManager: {
      getBranch: () => branch,
    },
  } as unknown as ExtensionContext;
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

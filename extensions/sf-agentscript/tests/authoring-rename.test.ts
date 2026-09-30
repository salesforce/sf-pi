/* SPDX-License-Identifier: Apache-2.0 */
/** Public family-tool Behavior Proofs for semantic Agent Script rename. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-authoring-rename-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function captureTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerAuthoringTool({
    registerTool: (definition: ToolDefinition) => (tool = definition),
  } as never);
  if (!tool) throw new Error("agentscript_authoring was not registered");
  return tool;
}

function context() {
  return createToolTestContext({ cwd, sessionManager: { getBranch: () => [] } });
}

async function writeAgent(name: string, source: string): Promise<string> {
  const file = path.join(cwd, name);
  await writeFile(file, source, "utf8");
  return file;
}

const SEMANTIC_SOURCE = `config:
  agent_name: "Public_Rename"
  agent_type: "AgentforceEmployeeAgent"
subagent billing:
  description: "Billing"
subagent billing_help:
  description: "Other"
start_agent main:
  description: "Mention @subagent.billing as prose"
  # Keep @subagent.billing in this comment
  before_reasoning:
    transition to @subagent.billing
  reasoning:
    instructions: ->
      | Explain @subagent.billing without invoking it.
`;

describe("agentscript_authoring semantic rename", () => {
  test("writes semantic edits and returns the stable mutation branch-state contract", async () => {
    const file = await writeAgent("Semantic.agent", SEMANTIC_SOURCE);
    const result = await captureTool().execute(
      "rename",
      {
        verb: "mutate",
        mode: "rename",
        agent_file: file,
        from: "@subagent.billing",
        to: "@subagent.account_billing",
      },
      undefined,
      undefined,
      context(),
    );

    const details = result.details as {
      ok?: boolean;
      action?: string;
      op?: string;
      applied_via?: string;
      sf_agentscript_branch_state?: Array<{ kind?: string; mode?: string }>;
    };
    expect(details).toMatchObject({
      ok: true,
      action: "mutate.rename",
      op: "rename",
      applied_via: "ast",
    });
    expect(details.sf_agentscript_branch_state).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent_file" }),
        expect.objectContaining({ kind: "mutation_result", mode: "rename" }),
      ]),
    );

    const after = await readFile(file, "utf8");
    expect(after).toContain("subagent account_billing:");
    expect(after).toContain("transition to @subagent.account_billing");
    expect(after).toContain('description: "Mention @subagent.billing as prose"');
    expect(after).toContain("# Keep @subagent.billing in this comment");
    expect(after).toContain("| Explain @subagent.billing without invoking it.");
    expect(after).toContain("subagent billing_help:");
  });

  test("routes topic conversion in both directions without rewriting prose", async () => {
    const topicFile = await writeAgent(
      "Topic.agent",
      SEMANTIC_SOURCE.replaceAll("subagent", "topic"),
    );
    const tool = captureTool();
    const forward = await tool.execute(
      "forward",
      {
        verb: "mutate",
        mode: "rename",
        agent_file: topicFile,
        from: "@topic.billing",
        to: "@subagent.billing",
      },
      undefined,
      undefined,
      context(),
    );
    expect(forward.details).toMatchObject({ ok: true, action: "mutate.rename" });
    let after = await readFile(topicFile, "utf8");
    expect(after).toContain("subagent billing:");
    expect(after).toContain("transition to @subagent.billing");
    expect(after).toContain('description: "Mention @topic.billing as prose"');

    const reverse = await tool.execute(
      "reverse",
      {
        verb: "mutate",
        mode: "rename",
        agent_file: topicFile,
        from: "@subagent.billing",
        to: "@topic.billing",
      },
      undefined,
      undefined,
      context(),
    );
    expect(reverse.details).toMatchObject({ ok: true, action: "mutate.rename" });
    after = await readFile(topicFile, "utf8");
    expect(after).toContain("topic billing:");
    expect(after).toContain("transition to @topic.billing");
    expect(after).toContain('description: "Mention @topic.billing as prose"');
  });

  test("refuses ambiguous scoped symbols with candidates and preserves the file", async () => {
    const source = `config:
  agent_name: "Ambiguous_Actions"
subagent first:
  description: "First"
  actions:
    lookup:
      description: "First lookup"
      target: "flow://First"
subagent second:
  description: "Second"
  actions:
    lookup:
      description: "Second lookup"
      target: "flow://Second"
start_agent main:
  description: "Main"
`;
    const file = await writeAgent("Ambiguous.agent", source);
    const result = await captureTool().execute(
      "ambiguous",
      {
        verb: "mutate",
        mode: "rename",
        agent_file: file,
        from: "@actions.lookup",
        to: "@actions.find_contact",
      },
      undefined,
      undefined,
      context(),
    );

    expect(result.details).toMatchObject({
      ok: false,
      reason: "ambiguous_symbol",
      candidates: [
        expect.objectContaining({ scope: { subagent: "first" } }),
        expect.objectContaining({ scope: { subagent: "second" } }),
      ],
    });
    expect(await readFile(file, "utf8")).toBe(source);
  });

  test("preserves malformed-source recovery guidance", async () => {
    const file = await writeAgent("Broken.agent", 'config:\n  agent_name "Broken"\n');
    const result = await captureTool().execute(
      "broken",
      {
        verb: "mutate",
        mode: "rename",
        agent_file: file,
        from: "@subagent.old",
        to: "@subagent.new",
      },
      undefined,
      undefined,
      context(),
    );
    expect(result.details).toMatchObject({
      ok: false,
      reason: "has_parse_errors",
      recover_via: {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: file },
      },
    });
  });
});

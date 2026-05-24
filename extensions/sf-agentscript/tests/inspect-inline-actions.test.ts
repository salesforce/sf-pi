/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Real-world recipes (CustomerServiceAgent etc.) declare actions inline
 * inside subagent / topic bodies, not at the top-level `actions:` block.
 * This test pins our walk so every `target:` URI surfaces in
 * components.actions[] regardless of where it's declared.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectFile } from "../lib/inspect.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-inline-actions-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const INLINE_AGENT_SOURCE = `# Inline-actions test agent
config:
   developer_name: "InlineActionsTest"
   agent_label: "InlineActionsTest"
   agent_type: "AgentforceEmployeeAgent"
   description: "Walks inline action declarations"

system:
   instructions: "test"

start_agent agent_router:
   description: "router"
   actions:
      route_check:
         description: "Checks route"
         target: "flow://RouteCheck"
   reasoning:
      instructions:|
         test
      actions:
         go: @utils.transition to @subagent.work
            description: "transition"

subagent work:
   description: "Has inline actions"
   actions:
      classify_issue:
         description: "Classifies"
         target: "apex://IssueClassifier"

      log_event:
         description: "Logs"
         target: "flow://LogEvent"
   reasoning:
      instructions: "do something"
`;

describe("inspectFile walks inline actions", () => {
  it("surfaces actions declared inside start_agent and subagent action blocks", async () => {
    const filePath = path.join(workDir, "InlineActionsTest.agent");
    await writeFile(filePath, INLINE_AGENT_SOURCE, "utf-8");
    const inspect = await inspectFile(filePath);
    expect(inspect.ok).toBe(true);
    const actions = inspect.components?.actions ?? [];
    expect(actions.length).toBe(3);
    const byName = new Map(actions.map((a) => [a.name, a]));
    expect(byName.get("route_check")?.target).toBe("flow://RouteCheck");
    expect(byName.get("route_check")?.parent).toBe("start_agent.agent_router");
    expect(byName.get("classify_issue")?.target).toBe("apex://IssueClassifier");
    expect(byName.get("classify_issue")?.parent).toBe("subagent.work");
    expect(byName.get("log_event")?.target).toBe("flow://LogEvent");
    expect(byName.get("log_event")?.parent).toBe("subagent.work");
    expect(inspect.stats?.actions).toBe(3);
  });
});

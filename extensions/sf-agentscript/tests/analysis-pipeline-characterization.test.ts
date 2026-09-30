/* SPDX-License-Identifier: Apache-2.0 */
/** Baseline parser-call characterization for the public Agent Script seams. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createToolTestContext } from "../../../lib/common/tests/extension-tool-context.ts";
import { clearAgentScriptAnalysisCache } from "../lib/analysis-snapshot.ts";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";
import { registerLifecycleTool } from "../lib/lifecycle-tool.ts";
import { resetSessionQualityOverrides } from "../lib/quality/publication-gate.ts";

const parserMetrics = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@sf-agentscript/agentforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf-agentscript/agentforce")>();
  return {
    ...actual,
    parse(source: string) {
      parserMetrics.calls++;
      return actual.parse(source);
    },
    compileSource(source: string, options?: Parameters<typeof actual.compileSource>[1]) {
      parserMetrics.calls++;
      return actual.compileSource(source, options);
    },
    getParser() {
      const parser = actual.getParser();
      return {
        parse(source: string) {
          parserMetrics.calls++;
          return parser.parse(source);
        },
      };
    },
  };
});

const MINIMAL_SOURCE = `system:
  instructions: "Help the user."
  messages:
    welcome: "Hello"
    error: "Error"
config:
  agent_name: "Parse_Probe"
  agent_type: "AgentforceEmployeeAgent"
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      | Respond helpfully.
`;

const RENAME_SOURCE = `system:
  instructions: "Help the user."
  messages:
    welcome: "Hello"
    error: "Error"
config:
  agent_name: "Rename_Probe"
  agent_type: "AgentforceEmployeeAgent"
subagent billing:
  description: "Billing"
start_agent main:
  description: "Rename entry"
  before_reasoning:
    transition to @subagent.billing
`;

const QUALITY_GATE_SOURCE = `system:
  instructions: "Help the user."
  messages:
    welcome: "Hello"
    error: "Error"
config:
  agent_name: "Gate_Probe"
  agent_type: "AgentforceEmployeeAgent"
start_agent main:
  description: "Main"
  before_reasoning:
    transition to @subagent.alpha
subagent alpha:
  description: "Alpha"
  before_reasoning:
    transition to @subagent.beta
subagent beta:
  description: "Beta"
  before_reasoning:
    transition to @subagent.alpha
`;

function captureAuthoringTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerAuthoringTool({
    registerTool: (definition: ToolDefinition) => (tool = definition),
  } as never);
  if (!tool) throw new Error("agentscript_authoring was not registered");
  return tool;
}

function captureLifecycleTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerLifecycleTool({
    registerTool: (definition: ToolDefinition) => (tool = definition),
  } as never);
  if (!tool) throw new Error("agentscript_lifecycle was not registered");
  return tool;
}

function context(cwd: string) {
  return createToolTestContext({ cwd, sessionManager: { getBranch: () => [] } });
}

async function countParserCalls(run: () => Promise<void>): Promise<number> {
  parserMetrics.calls = 0;
  await run();
  return parserMetrics.calls;
}

afterEach(() => {
  clearAgentScriptAnalysisCache();
  resetSessionQualityOverrides();
  vi.restoreAllMocks();
});

describe("Agent Script public-seam parser-call baseline", () => {
  test("characterizes compile and review analysis pipelines", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-parse-baseline-"));
    try {
      const compileFile = path.join(cwd, "Compile.agent");
      const reviewFile = path.join(cwd, "Review.agent");
      await writeFile(compileFile, MINIMAL_SOURCE, "utf8");
      await writeFile(reviewFile, MINIMAL_SOURCE, "utf8");
      const tool = captureAuthoringTool();

      const compileCalls = await countParserCalls(async () => {
        const result = await tool.execute(
          "compile",
          { verb: "compile", mode: "check", agent_file: compileFile },
          undefined,
          undefined,
          context(cwd),
        );
        expect(result.details).toMatchObject({ ok: true, clean: true });
      });
      clearAgentScriptAnalysisCache();
      const reviewCalls = await countParserCalls(async () => {
        const result = await tool.execute(
          "review",
          { verb: "inspect", mode: "review", agent_file: reviewFile },
          undefined,
          undefined,
          context(cwd),
        );
        expect(result.details).toMatchObject({ ok: true });
      });

      expect({ compileCalls, reviewCalls }).toEqual({ compileCalls: 2, reviewCalls: 2 });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reuses one dual analysis across compile, navigation, dry-run rename, and quality", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-parse-baseline-"));
    try {
      const file = path.join(cwd, "Workflow.agent");
      await writeFile(file, RENAME_SOURCE, "utf8");
      const tool = captureAuthoringTool();

      const calls = await countParserCalls(async () => {
        const compile = await tool.execute(
          "compile-shared",
          { verb: "compile", mode: "check", agent_file: file },
          undefined,
          undefined,
          context(cwd),
        );
        expect(compile.details).toMatchObject({ ok: true, clean: true });

        const definition = await tool.execute(
          "definition-shared",
          {
            verb: "inspect",
            mode: "definition",
            agent_file: file,
            symbol: "@subagent.billing",
          },
          undefined,
          undefined,
          context(cwd),
        );
        expect(definition.details).toMatchObject({ ok: true, symbol: "@subagent.billing" });

        const rename = await tool.execute(
          "rename-shared",
          {
            verb: "mutate",
            mode: "rename",
            agent_file: file,
            from: "@subagent.billing",
            to: "@subagent.account_billing",
            dry_run: true,
          },
          undefined,
          undefined,
          context(cwd),
        );
        expect(rename.details).toMatchObject({ ok: true, was_dry_run: true });

        const quality = await tool.execute(
          "quality-shared",
          { verb: "inspect", mode: "quality", agent_file: file },
          undefined,
          undefined,
          context(cwd),
        );
        expect(quality.details).toMatchObject({ ok: true });
      });

      expect(calls).toBe(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reuses cached code actions for dry-run quick-fix mutation", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-parse-baseline-"));
    try {
      const file = path.join(cwd, "QuickFix.agent");
      await writeFile(
        file,
        `config:\n  agent_name: "Quick_Fix"\ntopic billing:\n  description: "Billing"\nstart_agent main:\n  description: "Main"\n  before_reasoning:\n    transition to @topic.billing\n`,
        "utf8",
      );

      const calls = await countParserCalls(async () => {
        const result = await captureAuthoringTool().execute(
          "quick-fix",
          {
            verb: "mutate",
            mode: "apply_quick_fix",
            agent_file: file,
            diagnostic_code: "deprecated-field",
            line: 3,
            fix_index: 0,
            dry_run: true,
          },
          undefined,
          undefined,
          context(cwd),
        );
        expect(result.details).toMatchObject({ ok: true, was_dry_run: true });
      });

      expect(calls).toBe(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("characterizes dry-run rename and publication quality preflight", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-parse-baseline-"));
    try {
      const renameFile = path.join(cwd, "Rename.agent");
      const gateFile = path.join(cwd, "Gate.agent");
      await writeFile(renameFile, RENAME_SOURCE, "utf8");
      await writeFile(gateFile, QUALITY_GATE_SOURCE, "utf8");

      const renameCalls = await countParserCalls(async () => {
        const result = await captureAuthoringTool().execute(
          "rename",
          {
            verb: "mutate",
            mode: "rename",
            agent_file: renameFile,
            from: "@subagent.billing",
            to: "@subagent.account_billing",
            dry_run: true,
          },
          undefined,
          undefined,
          context(cwd),
        );
        expect(result.details).toMatchObject({ ok: true, was_dry_run: true });
      });
      clearAgentScriptAnalysisCache();
      const publicationPreflightCalls = await countParserCalls(async () => {
        const result = await captureLifecycleTool().execute(
          "publish-gate",
          { action: "publish", agent_file: gateFile, agent_api_name: "Gate_Probe" },
          undefined,
          undefined,
          context(cwd),
        );
        expect(result.details).toMatchObject({ ok: false, action: "publish.quality_gate" });
      });

      expect({ renameCalls, publicationPreflightCalls }).toEqual({
        renameCalls: 2,
        publicationPreflightCalls: 2,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

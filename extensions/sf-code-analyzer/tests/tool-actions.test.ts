/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_ANALYZER_DETAILS_KEY, registerCodeAnalyzerTool } from "../lib/code_analyzer-tool.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-tool-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function captureTool(sendUserMessage = vi.fn()): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerCodeAnalyzerTool({
    registerTool: (definition: ToolDefinition) => {
      tool = definition;
    },
    sendUserMessage,
    exec: vi.fn(),
  } as never);
  if (!tool) throw new Error("code_analyzer was not registered");
  return tool;
}

function ctx(branch: unknown[] = [], hasUI = false, confirm = vi.fn()): ExtensionContext {
  return {
    cwd,
    hasUI,
    ui: { confirm },
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
}

describe("code_analyzer tool actions", () => {
  it("uses a self-rendered shell so Code Analyzer cards can avoid default status backgrounds", () => {
    const tool = captureTool();

    expect(tool.renderShell).toBe("self");
    expect(tool.renderCall).toBeTypeOf("function");
    expect(tool.renderResult).toBeTypeOf("function");
  });

  it("returns scan recipes with structured suggestions and Herdr handoff details", async () => {
    const tool = captureTool();
    const result = await tool.execute(
      "call-1",
      {
        action: "recipes",
        target: ["force-app/main/default/classes/Foo.cls"],
        output_mode: "inline",
      },
      undefined,
      undefined,
      ctx(),
    );

    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const envelope = (result.details as Record<string, unknown>)[CODE_ANALYZER_DETAILS_KEY] as {
      suggestions: Array<{ id: string }>;
      herdrHandoff: Array<{ recipeId: string }>;
    };
    expect(text).toContain("SF Code Analyzer scan recipes");
    expect(envelope.suggestions.map((recipe: { id: string }) => recipe.id)).toEqual(["security"]);
    expect(envelope.herdrHandoff.map((handoff: { recipeId: string }) => handoff.recipeId)).toEqual([
      "security",
    ]);
  });

  it("summarizes an explicit report artifact with last_report filters", async () => {
    const report = path.join(cwd, "report.json");
    writeFileSync(
      report,
      JSON.stringify({
        runDir: cwd,
        versions: { "code-analyzer": "test" },
        violations: [
          {
            engine: "pmd",
            rule: "ApexCRUDViolation",
            severity: 2,
            primaryLocationIndex: 0,
            locations: [{ file: "classes/Foo.cls", startLine: 10, startColumn: 1 }],
            message: "Validate CRUD",
            resources: [],
          },
          {
            engine: "eslint",
            rule: "no-var",
            severity: 4,
            primaryLocationIndex: 0,
            locations: [{ file: "lwc/foo/foo.js", startLine: 1, startColumn: 1 }],
            message: "Unexpected var",
            resources: [],
          },
        ],
      }),
    );

    const tool = captureTool();
    const result = await tool.execute(
      "call-1",
      {
        action: "last_report",
        report_file: report,
        engine: "pmd",
        severity_threshold: "high",
        output_mode: "file_only",
      },
      undefined,
      undefined,
      ctx(),
    );

    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const envelope = (result.details as Record<string, unknown>)[CODE_ANALYZER_DETAILS_KEY] as {
      report: { run: { violations: Array<{ rule: string }> } };
      facts: { total: number; topRules: Array<{ label: string }> };
    };
    expect(text).toContain("Violations: 1");
    expect(text).toContain(report);
    expect(envelope.report.run.violations).toHaveLength(1);
    expect(envelope.report.run.violations[0].rule).toBe("ApexCRUDViolation");
    expect(envelope.facts.total).toBe(1);
    expect(envelope.facts.topRules[0].label).toBe("ApexCRUDViolation");
  });

  it("does not queue ApexGuru browser setup follow-up when confirmation is declined", async () => {
    const sendUserMessage = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const tool = captureTool(sendUserMessage);

    await tool.execute(
      "call-1",
      { action: "apexguru_setup_help", start_browser_workflow: true, target_org: "SomeOrg" },
      undefined,
      undefined,
      ctx([], true, confirm),
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("queues ApexGuru browser setup follow-up only after confirmation", async () => {
    const sendUserMessage = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const tool = captureTool(sendUserMessage);

    await tool.execute(
      "call-1",
      { action: "apexguru_setup_help", start_browser_workflow: true, target_org: "SomeOrg" },
      undefined,
      undefined,
      ctx([], true, confirm),
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Use SF Browser"), {
      deliverAs: "followUp",
    });
  });
});

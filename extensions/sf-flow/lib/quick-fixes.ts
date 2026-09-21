/* SPDX-License-Identifier: Apache-2.0 */
/** Source-bound deterministic quick fixes for three low-risk Flow findings. */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeFlowSource, resolveFlowFile } from "./analyzer.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import { resolveFlowWorkspace } from "./project.ts";
import type { FlowAnalysis, SfFlowParams, ToolResult } from "./types.ts";
import { childText, descendants, parseFlowXml } from "./xml.ts";

export interface FlowQuickFix {
  id: string;
  rule_id: "invalid-api-version" | "missing-auto-layout" | "unused-variable";
  description: string;
  source_version: string;
  line: number;
  element?: string;
  target_value?: string;
}

export function sourceVersion(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function listFlowQuickFixes(
  source: string,
  analysis: FlowAnalysis,
  cwd: string,
): Promise<FlowQuickFix[]> {
  const version = sourceVersion(source);
  const projectVersion = await projectApiVersion(cwd);
  const fixes: FlowQuickFix[] = [];
  for (const finding of analysis.findings) {
    if (finding.rule_id === "invalid-api-version") {
      fixes.push({
        id: quickFixId("invalid-api-version"),
        rule_id: "invalid-api-version",
        description: `Set apiVersion to the project source version (${projectVersion}).`,
        source_version: version,
        line: finding.line,
        target_value: projectVersion,
      });
    } else if (finding.rule_id === "missing-auto-layout") {
      fixes.push({
        id: quickFixId("missing-auto-layout"),
        rule_id: "missing-auto-layout",
        description: "Set CanvasMode to AUTO_LAYOUT_CANVAS.",
        source_version: version,
        line: finding.line,
        target_value: "AUTO_LAYOUT_CANVAS",
      });
    } else if (finding.rule_id === "unused-variable" && finding.element) {
      fixes.push({
        id: quickFixId("unused-variable", finding.element),
        rule_id: "unused-variable",
        description: `Remove unused local variable ${finding.element}.`,
        source_version: version,
        line: finding.line,
        element: finding.element,
      });
    }
  }
  return dedupeFixes(fixes);
}

export async function applyFlowQuickFix(params: SfFlowParams, cwd: string): Promise<ToolResult> {
  if (!params.file) throw new Error("file is required for fix.apply");
  if (!params.fix_id || !params.source_version) {
    throw new Error("fix_id and source_version from diagnose.file are required for fix.apply");
  }
  const workspace = await resolveFlowWorkspace(params.workspace, cwd);
  const file = await resolveFlowFile(params.file, workspace);
  const source = await readFile(file.absolute, "utf8");
  const currentVersion = sourceVersion(source);
  if (currentVersion !== params.source_version) {
    throw new Error(
      "Quick fix source is stale; re-run diagnose.file and use the new source_version.",
    );
  }

  const profile = params.quality_profile ?? "review";
  const before = analyzeFlowSource(source, file.display, { profile });
  const available = await listFlowQuickFixes(source, before, workspace);
  const fix = available.find((candidate) => candidate.id === params.fix_id);
  if (!fix) throw new Error(`Quick fix ${params.fix_id} is not available on the current source.`);

  const updated = applyFixToSource(source, fix);
  if (updated === source) throw new Error(`Quick fix ${fix.id} produced no source change.`);
  await writeFile(file.absolute, updated, "utf8");

  const after = analyzeFlowSource(updated, file.display, { profile });
  const remaining = await listFlowQuickFixes(updated, after, workspace);
  const artifact = await writeFlowArtifact(
    "quick-fixes",
    `${artifactTimestamp()}-${path.basename(file.absolute)}-${fix.rule_id}.json`,
    {
      fix,
      before_source_version: currentVersion,
      after_source_version: sourceVersion(updated),
      before_summary: before.summary,
      after_summary: after.summary,
      remaining_quick_fixes: remaining,
    },
  );
  const digest = buildFlowDigest({
    action: "fix.apply",
    kind: "flow_quick_fix",
    status: after.summary.high ? "fail" : after.summary.moderate ? "warning" : "pass",
    icon: "🛠️",
    title: "Flow Quick Fix · applied",
    meta: [file.display, fix.rule_id],
    rail: [{ kind: "Local", target: "source-bound quick fix", detail: fix.id }],
    sections: [
      section("🧾", "Change", [
        row("✅", "Rule", fix.rule_id),
        row("🛠️", "Fix", fix.description),
        row(
          "🔐",
          "Source",
          `${currentVersion.slice(0, 8)} → ${sourceVersion(updated).slice(0, 8)}`,
        ),
      ]),
      section("📊", "After Diagnosis", [
        row("🔴", "High", after.summary.high),
        row("🟠", "Moderate", after.summary.moderate),
        row("🛠️", "Fixes left", remaining.length),
      ]),
    ],
    artifacts: [artifact],
    next_step:
      after.summary.high || after.summary.moderate
        ? "Continue with the smallest relevant repair or apply another current source-bound quick fix."
        : "Run validate.check when local generation findings are resolved.",
  });
  return toolResultFromDigest(digest, {
    file: file.display,
    applied_fix: fix,
    source_version: sourceVersion(updated),
    analysis: after,
    quick_fixes: remaining,
    artifacts: [artifact],
  });
}

function applyFixToSource(source: string, fix: FlowQuickFix): string {
  if (fix.rule_id === "invalid-api-version") {
    const value = fix.target_value ?? "68.0";
    if (/<apiVersion>[\s\S]*?<\/apiVersion>/.test(source)) {
      return source.replace(
        /<apiVersion>[\s\S]*?<\/apiVersion>/,
        `<apiVersion>${value}</apiVersion>`,
      );
    }
    return source.replace(
      /<Flow\b[^>]*>/,
      (root) => `${root}\n    <apiVersion>${value}</apiVersion>`,
    );
  }
  if (fix.rule_id === "missing-auto-layout") return applyAutoLayout(source);
  if (fix.rule_id === "unused-variable" && fix.element) {
    const parsed = parseFlowXml(source);
    const variable = parsed.root?.children.find(
      (node) => node.name === "variables" && childText(node, "name") === fix.element,
    );
    if (!variable) throw new Error(`Unused variable ${fix.element} no longer exists.`);
    return removeNodeAndLineWhitespace(source, variable.start, variable.end);
  }
  throw new Error(`Unsupported quick fix rule: ${fix.rule_id}`);
}

function applyAutoLayout(source: string): string {
  const parsed = parseFlowXml(source);
  const entry = parsed.root?.children.find(
    (node) => node.name === "processMetadataValues" && childText(node, "name") === "CanvasMode",
  );
  const value = entry ? descendants(entry).find((node) => node.name === "stringValue") : undefined;
  if (value) {
    return `${source.slice(0, value.start)}<stringValue>AUTO_LAYOUT_CANVAS</stringValue>${source.slice(value.end)}`;
  }
  const block = [
    "    <processMetadataValues>",
    "        <name>CanvasMode</name>",
    "        <value>",
    "            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>",
    "        </value>",
    "    </processMetadataValues>",
  ].join("\n");
  if (!/<processType>/.test(source))
    throw new Error("Cannot place CanvasMode without processType.");
  return source.replace(/\s*<processType>/, `\n${block}\n    <processType>`);
}

async function projectApiVersion(cwd: string): Promise<string> {
  try {
    const project = JSON.parse(await readFile(path.join(cwd, "sfdx-project.json"), "utf8")) as {
      sourceApiVersion?: unknown;
    };
    if (
      typeof project.sourceApiVersion === "string" &&
      /^\d+(?:\.\d+)?$/.test(project.sourceApiVersion)
    ) {
      return project.sourceApiVersion;
    }
  } catch {
    // Use the current SF Flow baseline when no SFDX project is available.
  }
  return "68.0";
}

function quickFixId(ruleId: string, element?: string): string {
  return [ruleId, element].filter(Boolean).join(":");
}

function dedupeFixes(fixes: FlowQuickFix[]): FlowQuickFix[] {
  return [...new Map(fixes.map((fix) => [fix.id, fix])).values()];
}

function removeNodeAndLineWhitespace(source: string, start: number, end: number): string {
  let from = start;
  let to = end;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) from -= 1;
  if (from > 0 && source[from - 1] === "\n") from -= 1;
  while (to < source.length && (source[to] === " " || source[to] === "\t")) to += 1;
  if (source[to] === "\r") to += 1;
  if (source[to] === "\n") to += 1;
  return source.slice(0, from) + source.slice(to);
}

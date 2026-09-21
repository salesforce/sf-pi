/* SPDX-License-Identifier: Apache-2.0 */
/** Lean SF Flow lifecycle operation exports and local result shaping. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { analyzeFlowFile, resolveFlowFile } from "./analyzer.ts";
import { artifactTimestamp, writeFlowArtifact } from "./artifacts.ts";
import { buildAuthoringPlan } from "./author.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import {
  defaultFlowTestAdapter,
  discoverFlowTests,
  getFlowTestResult,
  planFlowTests,
  rerunFlowTests,
  runFlowTests,
} from "./flow-tests.ts";
import { projectScan, resolveFlowWorkspace } from "./project.ts";
import { buildTopologyEvidence } from "./topology.ts";
import { listFlowQuickFixes, sourceVersion, type FlowQuickFix } from "./quick-fixes.ts";
import { FLOW_QUALITY_RULES, type FlowQualityProfile } from "./quality/catalog.ts";
import type { SfFlowParams, SfFlowSessionState, ToolResult } from "./types.ts";
import { validateFlowCheck } from "./validation.ts";

export {
  buildAuthoringPlan,
  discoverFlowTests,
  getFlowTestResult,
  planFlowTests,
  projectScan,
  rerunFlowTests,
  runFlowTests,
  validateFlowCheck,
};

export function qualityRules(params: SfFlowParams): ToolResult {
  const profile = params.quality_profile as FlowQualityProfile | undefined;
  const rules = FLOW_QUALITY_RULES.filter((rule) => !profile || rule.profiles.includes(profile));
  const implemented = rules.filter((rule) => rule.implementation === "implemented");
  const inspired = rules.filter((rule) => rule.provenance.lightning_flow_scanner);
  const digest = buildFlowDigest({
    action: "quality.rules",
    kind: "flow_quality_catalog",
    status: "pass",
    icon: "📚",
    title: "Flow Quality Rules",
    meta: [profile ?? "all profiles", `${implemented.length}/${rules.length} implemented`],
    rail: [
      { kind: "Local", target: "SF Flow rule registry", detail: "independent implementation" },
      {
        kind: "Credit",
        target: "Lightning Flow Scanner",
        detail: `${inspired.length} inspired rule contract(s) · MIT`,
      },
    ],
    sections: [
      section("📊", "Catalog", [
        row("✅", "Implemented", implemented.length),
        row("🗓️", "Planned", rules.length - implemented.length),
        row("💡", "Inspired", inspired.length),
        row("🧭", "Profile", profile ?? "all"),
      ]),
      section(
        "🛡️",
        "Generation Rules",
        rules
          .filter(
            (rule) => rule.implementation === "implemented" && rule.profiles.includes("generation"),
          )
          .slice(0, Math.max(1, Math.min(Math.floor(params.limit ?? 25), 100)))
          .map((rule) => row(severityIcon(rule.default_severity), rule.id, rule.label)),
      ),
    ],
    next_step:
      "Use author.plan to compile preventive constraints or diagnose.file to execute a profile.",
  });
  return toolResultFromDigest(digest, {
    profile: profile ?? null,
    rules,
    count: rules.length,
    implemented: implemented.length,
    acknowledgement: {
      project: "Lightning Flow Scanner",
      license: "MIT",
      url: "https://github.com/Flow-Scanner/lightning-flow-scanner",
      implementation: "independent SF Pi white-room reimplementation",
    },
  });
}

export function status(session: SalesforceSession, params: SfFlowParams): ToolResult {
  const digest = buildFlowDigest({
    action: "status",
    kind: "flow_status",
    status: "pass",
    icon: "🌊",
    title: "SF Flow · ready",
    org: {
      alias: session.target.alias ?? params.target_org,
      api_version: session.target.apiVersion,
    },
    rail: [{ kind: "Connection", target: "sf-conn", detail: "API-native · cached session" }],
    sections: [
      section("✅", "Readiness", [
        row("🟢", "Connection", "ready"),
        row("🌐", "API", `v${session.target.apiVersion}`),
        row("🧩", "Authoring", "core five Flow families"),
        row("🛡️", "Mutation", "no deploy or activation actions"),
      ]),
    ],
    next_step: "Scan the project, plan a Flow, or inspect one Flow file.",
  });
  return toolResultFromDigest(digest);
}

export async function orgPreflight(
  session: SalesforceSession,
  params: SfFlowParams,
): Promise<ToolResult> {
  const flowProbe = await session.query<Record<string, unknown>>({
    soql: "SELECT Id, ApiName, ProcessType, TriggerType FROM FlowDefinitionView LIMIT 1",
    api: "rest",
    maxRows: 1,
  });
  let testDiscovery = "available";
  let testCandidates = 0;
  try {
    testCandidates = (await defaultFlowTestAdapter.discover(session, 1)).length;
  } catch (error) {
    testDiscovery = `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
  const warning = testDiscovery !== "available";
  const digest = buildFlowDigest({
    action: "org.preflight",
    kind: "flow_org_preflight",
    status: warning ? "warning" : "pass",
    icon: "🩺",
    title: `Flow Org Preflight · ${warning ? "partial" : "ready"}`,
    org: {
      alias: session.target.alias ?? params.target_org,
      api_version: session.target.apiVersion,
    },
    rail: [
      { kind: "GET", target: "/query FlowDefinitionView", detail: "limit=1" },
      { kind: "GET", target: "/tooling/query FlowTest", detail: "bounded discovery probe" },
    ],
    sections: [
      section("✅", "Readiness", [
        row("🌊", "Flow metadata", flowProbe.totalSize !== undefined ? "queryable" : "available"),
        row(
          testDiscovery === "available" ? "🟢" : "🟡",
          "Flow tests",
          testDiscovery === "available"
            ? `available · ${testCandidates} candidate${testCandidates === 1 ? "" : "s"}`
            : testDiscovery,
        ),
        row("🌐", "API", `v${session.target.apiVersion}`),
      ]),
    ],
    next_step: warning
      ? "Use local diagnosis and check-only validation; inspect Flow test permissions separately."
      : "Proceed with local diagnosis, validation, or targeted tests.",
  });
  return toolResultFromDigest(digest, {
    flow_definition_queryable: true,
    flow_test_discovery: testDiscovery,
    flow_test_candidates: testCandidates,
  });
}

export async function flowInspect(params: SfFlowParams, cwd: string): Promise<ToolResult> {
  if (!params.file) throw new Error("file is required for flow.inspect");
  const workspace = await resolveFlowWorkspace(params.workspace, cwd);
  const analysis = await analyzeFlowFile(params.file, workspace, {
    profile: params.quality_profile ?? "review",
  });
  if (!analysis.model) return diagnosticResult(params, analysis);
  const topologyEvidence = buildTopologyEvidence(analysis.model);
  const topology = topologyEvidence.display;
  const stamp = `${artifactTimestamp()}-${safeBase(analysis.file)}`;
  const structureArtifact = await writeFlowArtifact("inspections", `${stamp}.json`, analysis.model);
  const topologyArtifact = await writeFlowArtifact(
    "topology",
    `${stamp}.mmd`,
    topologyEvidence.artifact.mermaid,
  );
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 20), 50));
  const digest = buildFlowDigest({
    action: "flow.inspect",
    kind: "flow_inspection",
    status: analysis.summary.high ? "fail" : analysis.findings.length ? "warning" : "pass",
    icon: "🌊",
    title: "Flow Inspection",
    meta: [analysis.file, analysis.family],
    rail: [
      {
        kind: "Local",
        target: "XML → graph model",
        detail: `${analysis.model.elements.length} elements`,
      },
    ],
    sections: [
      section("🧩", "Flow", [
        row("🏷️", "Label", analysis.model.label),
        row("🧩", "Family", analysis.family),
        row("⚡", "Trigger", analysis.model.trigger_type ?? "caller launched"),
        row("📦", "Object/Event", analysis.model.object),
      ]),
      section(
        "🧱",
        "Elements",
        analysis.model.elements
          .slice(0, limit)
          .map((element) =>
            row("•", `${element.line}:${element.column}`, `${element.kind} · ${element.name}`),
          ),
      ),
    ],
    topology,
    artifacts: [structureArtifact, topologyArtifact],
    next_step: analysis.findings.length
      ? "Run diagnose.file and fix the first high-severity finding."
      : "Run validate.check before relying on deployment readiness.",
  });
  return toolResultFromDigest(digest, {
    file: analysis.file,
    family: analysis.family,
    model: analysis.model,
    findings: analysis.findings.slice(0, limit),
    coverage: analysis.coverage,
    artifacts: [structureArtifact, topologyArtifact],
  });
}

export async function diagnoseFile(params: SfFlowParams, cwd: string): Promise<ToolResult> {
  if (!params.file) throw new Error("file is required for diagnose.file");
  const workspace = await resolveFlowWorkspace(params.workspace, cwd);
  const resolved = await resolveFlowFile(params.file, workspace);
  const source = await readFile(resolved.absolute, "utf8");
  const analysis = await analyzeFlowFile(params.file, workspace, {
    profile: params.quality_profile ?? "review",
  });
  const quickFixes = await listFlowQuickFixes(source, analysis, workspace);
  return diagnosticResult(params, analysis, quickFixes, sourceVersion(source));
}

async function diagnosticResult(
  params: SfFlowParams,
  analysis: Awaited<ReturnType<typeof analyzeFlowFile>>,
  quickFixes: FlowQuickFix[] = [],
  currentSourceVersion?: string,
): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 25), 100));
  const topologyEvidence = analysis.model ? buildTopologyEvidence(analysis.model) : undefined;
  const topology = topologyEvidence?.display;
  const stamp = `${artifactTimestamp()}-${safeBase(analysis.file)}`;
  const diagnosticArtifact = await writeFlowArtifact("diagnostics", `${stamp}.json`, {
    analysis,
    source_version: currentSourceVersion,
    quick_fixes: quickFixes,
  });
  const topologyArtifact = topologyEvidence
    ? await writeFlowArtifact("topology", `${stamp}.mmd`, topologyEvidence.artifact.mermaid)
    : undefined;
  const artifacts = [diagnosticArtifact, ...(topologyArtifact ? [topologyArtifact] : [])];
  const digest = buildFlowDigest({
    action: params.action === "flow.inspect" ? "flow.inspect" : "diagnose.file",
    kind: "flow_diagnostics",
    status: analysis.summary.high ? "fail" : analysis.findings.length ? "warning" : "pass",
    icon: "🩺",
    title: `Flow Diagnostics · ${analysis.status}`,
    meta: [analysis.file, analysis.family, `profile=${params.quality_profile ?? "review"}`],
    rail: [
      { kind: "Local", target: "fast Flow rules", detail: `${analysis.coverage.ran.length} ran` },
    ],
    sections: [
      section("📊", "Summary", [
        row("🔴", "High", analysis.summary.high),
        row("🟠", "Moderate", analysis.summary.moderate),
        row("🔵", "Low", analysis.summary.low),
        row("⚪", "Skipped", analysis.coverage.skipped.length),
      ]),
      section(
        "🛠️",
        "Safe Quick Fixes",
        quickFixes.length
          ? quickFixes.map((fix) => row("🛠️", fix.rule_id, fix.description))
          : [row("⚪", "Available", "none")],
      ),
      section(
        "🧯",
        "Findings",
        analysis.findings.length
          ? analysis.findings
              .slice(0, limit)
              .map((finding) =>
                row(
                  severityIcon(finding.severity),
                  `${finding.line}:${finding.column}`,
                  `${finding.rule_id} · ${finding.message}`,
                ),
              )
          : [row("✅", "None", "no local findings")],
      ),
    ],
    topology,
    artifacts,
    next_step: analysis.summary.high
      ? "Fix the first high-severity finding and diagnose again."
      : "Run validate.check for Salesforce deployment semantics.",
  });
  return toolResultFromDigest(digest, {
    file: analysis.file,
    family: analysis.family,
    status: analysis.status,
    summary: analysis.summary,
    findings: analysis.findings.slice(0, limit),
    findings_total: analysis.findings.length,
    coverage: analysis.coverage,
    quality_profile: params.quality_profile ?? "review",
    source_version: currentSourceVersion,
    quick_fixes: quickFixes,
    artifacts,
  });
}

export async function testRerun(
  session: SalesforceSession,
  params: SfFlowParams,
  state: SfFlowSessionState,
): Promise<ToolResult> {
  return rerunFlowTests(params, session, state);
}

function severityIcon(severity: string): string {
  if (severity === "high") return "🔴";
  if (severity === "moderate") return "🟠";
  if (severity === "low") return "🔵";
  return "⚪";
}

function safeBase(file: string): string {
  return path.basename(file).replace(/[^A-Za-z0-9._-]/g, "_");
}

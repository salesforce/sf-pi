/* SPDX-License-Identifier: Apache-2.0 */
/** Inspect actions for agentscript_authoring. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { getAgentScriptAnalysis } from "../../analysis-snapshot.ts";
import {
  agentFileEvent,
  resolveCurrentAgentFile,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { buildFeatureProfile } from "../../feature-profile.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { findDefinition, findReferences } from "../../inspect.ts";
import { connFromAlias } from "../../../../../lib/common/sf-conn/connection.ts";
import { checkActionTargets } from "../../preflight.ts";
import { diagnoseRuntimeSmoke, type RuntimeSmokeResult } from "../../preflight/runtime-smoke.ts";
import { collectOrgReviewFindings } from "../../review/org-checks.ts";
import type { ReviewFinding } from "../../review/types.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { TimingCollector } from "../../timings.ts";
import type { AuthoringParams } from "../params.ts";

export type ReviewReadiness = "ready" | "ready_with_warnings" | "blocked" | "partial";

export async function runInspectAction(
  ctx: ExtensionContext,
  input: AuthoringParams,
  timings?: TimingCollector,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = await resolveCurrentAgentFile(ctx, input.agent_file, (value) =>
    safeResolveToolPath(value, ctx.cwd),
  );
  if ("agentFile" in resolved === false) return resolved;
  const agentFile = resolved.agentFile;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }
  const mode = input.mode ?? "structure";
  switch (mode) {
    case "structure":
      return actionStructure(agentFile, timings);
    case "context_profile":
      return actionContextProfile(agentFile, timings);
    case "find_references":
      return actionFindReferences(agentFile, input.symbol as string, timings);
    case "definition":
      return actionDefinition(agentFile, input.symbol as string, timings);
    case "check_targets":
      return actionCheckTargets(agentFile, input.target_org, timings);
    case "review":
      return actionReview(ctx, agentFile, input, timings);
    case "runtime_smoke":
      return actionRuntimeSmoke(agentFile, input, timings);
    default:
      return toolError("INVALID_PARAMS", `Unsupported inspect mode '${String(mode)}'.`);
  }
}

async function actionStructure(agentFile: string, timings?: TimingCollector) {
  const result = timings
    ? await timings.time("inspect_structure", async () =>
        (await getAgentScriptAnalysis(agentFile)).getInspect(),
      )
    : await (await getAgentScriptAnalysis(agentFile)).getInspect();
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the official SDK package.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    return toolError(`Inspect failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }

  return toolOk(
    withAgentScriptBranchState(
      {
        ok: true as const,
        action: "inspect.structure" as const,
        agent_file: agentFile,
        path: agentFile,
        dialect: result.dialect,
        components: result.components,
        stats: result.stats,
        has_parse_errors: result.has_parse_errors ?? false,
        parse_error_count: result.parse_error_count ?? 0,
      },
      inspectEvents(agentFile, "structure", result.has_parse_errors, result.parse_error_count),
    ),
    renderStructureSummary(agentFile, result),
  );
}

async function actionContextProfile(agentFile: string, timings?: TimingCollector) {
  const analysis = await getAgentScriptAnalysis(agentFile);
  const result = timings
    ? await timings.time("inspect_structure", () => analysis.getInspect())
    : await analysis.getInspect();
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the official SDK package.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    return toolError(`context_profile failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }
  const profile = (await analysis.getFeatureProfile()) ?? buildFeatureProfile(result);
  const lines = [
    `🧬 Context profile ${agentFile}`,
    `linked: ${profile.linked_variables.length} · mutable: ${profile.mutable_variables.length} · ` +
      `modalities: ${profile.modalities.length} · response_formats: ${profile.response_formats.length}`,
  ];
  if (profile.context_variables_template.length > 0) {
    lines.push(`preview seed: ${profile.context_variables_template.map((v) => v.name).join(", ")}`);
  }
  if (profile.publish_risks.length > 0) {
    lines.push(`publish risks: ${profile.publish_risks.map((r) => r.code).join(", ")}`);
  }
  return toolOk(
    withAgentScriptBranchState(
      {
        ok: true as const,
        action: "inspect.context_profile" as const,
        agent_file: agentFile,
        path: agentFile,
        dialect: result.dialect,
        context_profile: profile,
      },
      inspectEvents(
        agentFile,
        "context_profile",
        result.has_parse_errors,
        result.parse_error_count,
      ),
    ),
    lines.join("\n"),
  );
}

async function actionFindReferences(agentFile: string, symbol: string, timings?: TimingCollector) {
  const result = timings
    ? await timings.time("find_references", () => findReferences(agentFile, symbol))
    : await findReferences(agentFile, symbol);
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the official SDK package.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    return toolError(`find_references failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }
  const refs = result.references ?? [];
  const declCount = refs.filter((r) => r.is_declaration).length;
  const usageCount = refs.length - declCount;
  const lines = [
    `🔎 ${symbol} — ${refs.length} hit(s) (${declCount} declaration, ${usageCount} usage${usageCount === 1 ? "" : "s"})`,
    ...refs.slice(0, 12).map((r) => {
      const tag = r.is_declaration ? "decl" : "use ";
      return `  ${tag} L${r.line}:${r.character} · ${r.context}`;
    }),
    refs.length > 12 ? `  …and ${refs.length - 12} more in details.references` : "",
  ].filter(Boolean);
  return toolOk(
    withAgentScriptBranchState(
      {
        ok: true as const,
        action: "inspect.find_references" as const,
        agent_file: agentFile,
        path: agentFile,
        symbol,
        references: refs,
        total: result.total ?? refs.length,
      },
      inspectEvents(agentFile, "find_references"),
    ),
    lines.join("\n"),
  );
}

async function actionDefinition(agentFile: string, symbol: string, timings?: TimingCollector) {
  const result = timings
    ? await timings.time("find_definition", () => findDefinition(agentFile, symbol))
    : await findDefinition(agentFile, symbol);
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the official SDK package.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    if (result.reason === "not_found") {
      return toolError(
        `${symbol} is not declared in ${agentFile}.`,
        "Use find_references to see if it's referenced anywhere.",
        {
          tool: "agentscript_authoring",
          params: { verb: "inspect", mode: "find_references", agent_file: agentFile, symbol },
        },
      );
    }
    return toolError(`definition failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }
  return toolOk(
    withAgentScriptBranchState(
      {
        ok: true as const,
        action: "inspect.definition" as const,
        agent_file: agentFile,
        path: agentFile,
        symbol,
        file: result.file,
        line: result.line,
        character: result.character,
      },
      inspectEvents(agentFile, "definition"),
    ),
    `📍 ${symbol} declared at ${result.file}:${result.line}:${result.character ?? 0}`,
  );
}

async function actionCheckTargets(
  agentFile: string,
  targetOrg: string | undefined,
  timings?: TimingCollector,
) {
  if (!targetOrg) {
    return toolError(
      "inspect.check_targets requires target_org.",
      "Pass target_org=<sf alias> so we can query the org via Tooling API.",
    );
  }
  const inspect = timings
    ? await timings.time("inspect_structure", async () =>
        (await getAgentScriptAnalysis(agentFile)).getInspect(),
      )
    : await (await getAgentScriptAnalysis(agentFile)).getInspect();
  if (!inspect.ok)
    return toolError(`Inspect failed: ${inspect.reason ?? "unknown"}`, inspect.reason_detail);
  const actions = inspect.components?.actions ?? [];
  if (actions.length === 0) {
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          action: "inspect.check_targets" as const,
          agent_file: agentFile,
          path: agentFile,
          targets: [],
          total: 0,
          resolved: 0,
          missing: 0,
          unverifiable: 0,
        },
        inspectEvents(agentFile, "check_targets"),
      ),
      `✓ ${agentFile} declares no actions — nothing to check.`,
    );
  }
  let conn;
  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(targetOrg);
    authPhase?.end({ cache: auth.cache });
    conn = auth.conn;
  } catch {
    conn = timings
      ? await timings.time("org_connection", () => connFromAlias(targetOrg))
      : await connFromAlias(targetOrg);
  }
  const result = timings
    ? await timings.time("action_target_preflight", () => checkActionTargets(conn, actions))
    : await checkActionTargets(conn, actions);
  const summaryLines = [
    result.ok
      ? `✓ All ${result.total} action target(s) resolved in org`
      : `⚠ ${result.missing}/${result.total} action target(s) missing in org`,
  ];
  for (const t of result.targets.slice(0, 8)) {
    const flag = t.status === "ok" ? "✓" : t.status === "missing" ? "✗" : "?";
    const detail = t.status === "ok" ? "" : ` — ${t.detail ?? "not verified"}`;
    summaryLines.push(`  ${flag} ${t.name} → ${t.target}${detail}`);
  }
  if (result.targets.length > 8)
    summaryLines.push(`  …and ${result.targets.length - 8} more in details.targets`);
  return toolOk(
    withAgentScriptBranchState(
      {
        ok: result.ok,
        action: "inspect.check_targets" as const,
        agent_file: agentFile,
        path: agentFile,
        total: result.total,
        resolved: result.resolved,
        missing: result.missing,
        unverifiable: result.unverifiable,
        targets: result.targets,
      },
      [
        ...inspectEvents(agentFile, "check_targets"),
        {
          schema_version: 1,
          kind: "inspect_result",
          agent_file: agentFile,
          mode: "check_targets",
          source: "inspect.check_targets",
        },
      ],
    ),
    summaryLines.join("\n"),
  );
}

async function actionRuntimeSmoke(
  agentFile: string,
  input: AuthoringParams,
  timings?: TimingCollector,
) {
  if (!input.target_org) {
    return toolError(
      "inspect.runtime_smoke requires target_org.",
      "Pass target_org=<sf alias> so we can query recent VoiceCall, AgentWork, and MessagingSession records.",
    );
  }
  let conn;
  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org);
    authPhase?.end({ cache: auth.cache });
    conn = auth.conn;
  } catch {
    conn = timings
      ? await timings.time("org_connection", () => connFromAlias(input.target_org))
      : await connFromAlias(input.target_org);
  }
  const smoke = timings
    ? await timings.time("runtime_smoke", () =>
        diagnoseRuntimeSmoke(conn, { phoneNumber: input.phone_number }),
      )
    : await diagnoseRuntimeSmoke(conn, { phoneNumber: input.phone_number });
  const details = withAgentScriptBranchState(
    {
      ok: smoke.ok,
      action: "inspect.runtime_smoke" as const,
      agent_file: agentFile,
      path: agentFile,
      target_org: input.target_org,
      runtime_smoke: smoke,
    },
    inspectEvents(agentFile, "runtime_smoke"),
  );
  return toolOk(details, renderRuntimeSmokeSummary(agentFile, smoke));
}

async function sourceShapeFindings(agentFile: string): Promise<ReviewFinding[]> {
  let source: string;
  try {
    source = await readFile(agentFile, "utf8");
  } catch {
    return [];
  }
  const lines = source.split("\n").map((raw, index) => ({
    raw,
    line: index + 1,
    trimmed: raw.trim(),
    indent: raw.length - raw.trimStart().length,
  }));
  const findings: ReviewFinding[] = [];
  const system = lines.find((line) => line.indent === 0 && /^system\s*:/.test(line.trimmed));
  if (!system) {
    findings.push({
      id: "missing-system-block",
      severity: "blocker",
      category: "shape",
      message:
        "Missing top-level system block. Preview/publish may succeed, but runtime session start can fail or fall back to incomplete prompt metadata.",
    });
    return findings;
  }
  const systemLines = lines.slice(system.line).filter((line) => line.trimmed.length > 0);
  const untilNextTop = systemLines.findIndex((line) => line.indent === 0);
  const block = untilNextTop >= 0 ? systemLines.slice(0, untilNextTop) : systemLines;
  if (!block.some((line) => /^instructions\s*:/.test(line.trimmed))) {
    findings.push({
      id: "missing-system-instructions",
      severity: "blocker",
      category: "shape",
      message: "system block is missing instructions.",
    });
  }
  if (!block.some((line) => /^messages\s*:/.test(line.trimmed))) {
    findings.push({
      id: "missing-system-messages",
      severity: "blocker",
      category: "shape",
      message: "system block is missing messages.welcome and messages.error.",
    });
    return findings;
  }
  if (!block.some((line) => /^welcome\s*:/.test(line.trimmed))) {
    findings.push({
      id: "missing-system-welcome-message",
      severity: "blocker",
      category: "shape",
      message: "system.messages is missing welcome.",
    });
  }
  if (!block.some((line) => /^error\s*:/.test(line.trimmed))) {
    findings.push({
      id: "missing-system-error-message",
      severity: "blocker",
      category: "shape",
      message: "system.messages is missing error.",
    });
  }
  return findings;
}

async function actionReview(
  ctx: ExtensionContext,
  agentFile: string,
  input: AuthoringParams,
  timings?: TimingCollector,
) {
  const findings: ReviewFinding[] = [];
  const analysis = await getAgentScriptAnalysis(agentFile);
  const compile = timings
    ? await timings.time("local_compile", () => analysis.getCompile())
    : await analysis.getCompile();
  if (!compile.ok) {
    findings.push({
      id: "compile-unavailable",
      severity: "blocker",
      category: "compile",
      message: compile.unavailableReason ?? "Agent Script compile unavailable.",
      recover_via: { tool: "sf-agentscript", params: { action: "doctor" } },
    });
  } else {
    for (const d of compile.diagnostics) {
      if (d.severity === 1) {
        findings.push({
          id: `compile-${d.code ?? "error"}-L${(d.range.start.line ?? 0) + 1}`,
          severity: "blocker",
          category: "compile",
          message: `${d.code ?? "compile-error"}: ${d.message}`,
          evidence: [`L${(d.range.start.line ?? 0) + 1}`],
          recover_via: {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: agentFile },
          },
        });
      } else if (d.severity === 2) {
        findings.push({
          id: `compile-${d.code ?? "warning"}-L${(d.range.start.line ?? 0) + 1}`,
          severity: "warning",
          category: "compile",
          message: `${d.code ?? "compile-warning"}: ${d.message}`,
          evidence: [`L${(d.range.start.line ?? 0) + 1}`],
        });
      }
    }
  }

  findings.push(
    ...(timings
      ? await timings.time("source_shape_checks", () => sourceShapeFindings(agentFile))
      : await sourceShapeFindings(agentFile)),
  );

  const inspect = timings
    ? await timings.time("inspect_structure", () => analysis.getInspect())
    : await analysis.getInspect();
  const parseBlocked = inspect.ok && inspect.has_parse_errors;
  if (!inspect.ok) {
    findings.push({
      id: "inspect-unavailable",
      severity: "blocker",
      category: "shape",
      message: `Inspect failed: ${inspect.reason ?? "unknown"}${inspect.reason_detail ? ` — ${inspect.reason_detail}` : ""}`,
    });
  } else {
    const stats = (inspect.stats ?? {}) as Record<string, number | undefined>;
    if ((stats.start_agents ?? 0) === 0) {
      findings.push({
        id: "missing-start-agent",
        severity: "blocker",
        category: "shape",
        message: "No start_agent block found.",
      });
    }
    if (
      (stats.subagents ?? 0) > 0 &&
      (inspect.components?.subagents ?? []).some((s) => !s.description)
    ) {
      findings.push({
        id: "subagent-description",
        severity: "warning",
        category: "shape",
        message: "One or more subagents are missing descriptions.",
      });
    }
    const profile = (await analysis.getFeatureProfile()) ?? buildFeatureProfile(inspect);
    for (const risk of profile.publish_risks) {
      findings.push({
        id: `publish-risk-${risk.code}`,
        severity: "warning",
        category: "deployment",
        message: risk.message,
        evidence: risk.evidence.slice(0, 3),
      });
    }
    if (input.target_org) {
      const actions = inspect.components?.actions ?? [];
      try {
        let conn;
        try {
          const authPhase = timings?.phase("agent_api_auth");
          const auth = await connForAgentApi(input.target_org);
          authPhase?.end({ cache: auth.cache });
          conn = auth.conn;
        } catch {
          conn = timings
            ? await timings.time("org_connection", () => connFromAlias(input.target_org))
            : await connFromAlias(input.target_org);
        }
        const orgFindings = timings
          ? await timings.time("org_review_preflight", () =>
              collectOrgReviewFindings({
                conn,
                actions,
                profile,
                config: inspect.components?.config ?? {},
                agentFile,
                targetOrg: input.target_org as string,
                phoneNumber: input.phone_number,
              }),
            )
          : await collectOrgReviewFindings({
              conn,
              actions,
              profile,
              config: inspect.components?.config ?? {},
              agentFile,
              targetOrg: input.target_org,
              phoneNumber: input.phone_number,
            });
        findings.push(...orgFindings);
      } catch (err) {
        findings.push({
          id: "target-check-failed",
          severity: "warning",
          category: "org",
          message: `Org target checks failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const readiness: ReviewReadiness = parseBlocked
    ? "partial"
    : blockers > 0
      ? "blocked"
      : warnings > 0
        ? "ready_with_warnings"
        : "ready";

  let outputPath: string | undefined;
  const detailsBase = {
    ok: true as const,
    action: "inspect.review" as const,
    agent_file: agentFile,
    path: agentFile,
    readiness,
    summary: {
      blockers,
      warnings,
      infos: findings.filter((f) => f.severity === "info").length,
    },
    structural_checks: parseBlocked ? "partial" : inspect.ok ? "complete" : "blocked",
    findings,
  };
  if (input.output_path) {
    outputPath = path.isAbsolute(input.output_path)
      ? input.output_path
      : path.resolve(ctx.cwd, input.output_path);
    await withFileMutationQueue(outputPath, async () => {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        renderReviewMarkdown({ ...detailsBase, output_path: outputPath }),
        "utf8",
      );
    });
  }

  const details = withAgentScriptBranchState(
    { ...detailsBase, ...(outputPath ? { output_path: outputPath } : {}) },
    [
      agentFileEvent(agentFile, "inspect.review"),
      {
        schema_version: 1,
        kind: "review_result",
        agent_file: agentFile,
        readiness,
        blocking_count: blockers,
        warning_count: warnings,
        ...(outputPath ? { output_path: outputPath } : {}),
        source: "inspect.review",
      },
    ],
  );

  return toolOk(details, renderReviewSummary(details));
}

function inspectEvents(
  agentFile: string,
  mode: string,
  hasParseErrors?: boolean,
  parseErrorCount?: number,
): AgentScriptBranchStateEvent[] {
  return [
    agentFileEvent(agentFile, `inspect.${mode}`),
    {
      schema_version: 1,
      kind: "inspect_result",
      agent_file: agentFile,
      mode,
      has_parse_errors: hasParseErrors,
      parse_error_count: parseErrorCount,
      source: `inspect.${mode}`,
    },
  ];
}

function renderStructureSummary(
  agentFile: string,
  result: {
    dialect?: { name: string; version?: string };
    stats?: Record<string, number>;
    has_parse_errors?: boolean;
    parse_error_count?: number;
  },
): string {
  const stats = (result.stats ?? {}) as Record<string, number | undefined>;
  const dialect = result.dialect
    ? `${result.dialect.name}${result.dialect.version ? ` ${result.dialect.version}` : ""}`
    : "unknown";
  const lines = [
    `📋 Inspected ${agentFile}`,
    `Dialect: ${dialect}`,
    `Stats: ${stats.start_agents ?? 0} start · ${stats.topics ?? 0} topics · ` +
      `${stats.subagents ?? 0} subagents · ${stats.variables ?? 0} variables · ` +
      `${stats.actions ?? 0} actions · ${stats.connections ?? 0} connections · ` +
      `${stats.modalities ?? 0} modalities`,
  ];
  if (result.has_parse_errors) {
    lines.push(
      `⚠️ File has ${result.parse_error_count ?? 1} severity-1 parse error(s) — run agentscript_authoring compile/check first; the structural surface may be incomplete.`,
    );
  }
  return lines.join("\n");
}

function renderRuntimeSmokeSummary(agentFile: string, smoke: RuntimeSmokeResult): string {
  const warningCount = smoke.findings.filter((finding) => finding.severity === "warning").length;
  const unverifiableCount = smoke.findings.filter(
    (finding) => finding.severity === "unverifiable",
  ).length;
  const icon = warningCount > 0 ? "⚠️" : unverifiableCount > 0 ? "❔" : "✅";
  const lines = [
    `${icon} Runtime smoke: ${smoke.surface}`,
    `agent_file: ${agentFile}`,
    `findings: ${warningCount} warning(s), ${unverifiableCount} unverifiable`,
  ];
  for (const finding of smoke.findings.slice(0, 6)) {
    const marker = finding.severity === "ok" ? "✓" : finding.severity === "warning" ? "⚠" : "?";
    lines.push(`  ${marker} ${finding.message}`);
    for (const evidence of finding.evidence ?? []) lines.push(`    ${evidence}`);
  }
  if (smoke.findings.length > 6) {
    lines.push(`  …and ${smoke.findings.length - 6} more in details.runtime_smoke.findings`);
  }
  return lines.join("\n");
}

function renderReviewSummary(details: {
  agent_file: string;
  readiness: ReviewReadiness;
  summary: { blockers: number; warnings: number; infos: number };
  output_path?: string;
}): string {
  const icon =
    details.readiness === "ready"
      ? "✅"
      : details.readiness === "blocked"
        ? "❌"
        : details.readiness === "partial"
          ? "⚠️"
          : "🟡";
  return [
    `${icon} Agent Script review: ${details.readiness}`,
    `agent_file: ${details.agent_file}`,
    `findings: ${details.summary.blockers} blocker(s), ${details.summary.warnings} warning(s), ${details.summary.infos} info`,
    details.output_path ? `report: ${details.output_path}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderReviewMarkdown(details: {
  agent_file: string;
  readiness: ReviewReadiness;
  summary: { blockers: number; warnings: number; infos: number };
  findings: ReviewFinding[];
  output_path?: string;
}): string {
  const lines = [
    `# Agent Script Review`,
    "",
    `Agent file: \`${details.agent_file}\``,
    `Readiness: **${details.readiness}**`,
    "",
    `Findings: ${details.summary.blockers} blocker(s), ${details.summary.warnings} warning(s), ${details.summary.infos} info`,
    "",
  ];
  if (details.findings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of details.findings) {
      lines.push(`- **${finding.severity}** [${finding.category}] ${finding.message}`);
      for (const evidence of finding.evidence ?? []) lines.push(`  - ${evidence}`);
    }
  }
  return lines.join("\n") + "\n";
}

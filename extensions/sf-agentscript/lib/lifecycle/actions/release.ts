/* SPDX-License-Identifier: Apache-2.0 */
/** Lifecycle release actions: publish, activate, deactivate, and list versions. */
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { getAgentScriptAnalysis } from "../../analysis-snapshot.ts";
import { connFromAlias, resolveOrgIdentity } from "../../../../../lib/common/sf-conn/index.ts";
import { checkAgentUserStatus, readAgentConfigSlice } from "../../agent-user/index.ts";
import { buildFeatureProfile, type AgentFeatureProfile } from "../../feature-profile.ts";
import { checkBundleVsBotDivergence } from "../../lifecycle-divergence.ts";
import { activateVersion, deactivateVersion, listVersions, publishAgent } from "../../lifecycle.ts";
import {
  evaluateQualityPublicationGate,
  sessionQualityOverrideLedger,
} from "../../quality/publication-gate.ts";
import { evaluateActivationEvidence } from "../../release-contract.ts";
import {
  agentFileEvent,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { TimingCollector } from "../../timings.ts";
import { classifyLifecycleError } from "../error-classification.ts";

const LIFECYCLE_TOOL_NAME = "agentscript_lifecycle";

export interface ReleaseLifecycleActionInput {
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  release_spec_path?: string;
  acknowledge_untested_activation?: boolean;
  version?: number;
}

export interface PublishLifecycleActionInput extends ReleaseLifecycleActionInput {
  acknowledge_quality_risk?: boolean;
}

function lifecycleVersionEvents(input: {
  agentApiName: string;
  agentFile?: string;
  botId?: string;
  botVersionId?: string;
  versionNumber?: number;
  status?: string;
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    ...(input.agentFile ? [agentFileEvent(input.agentFile, input.source)] : []),
    {
      schema_version: 1 as const,
      kind: "lifecycle_version" as const,
      agent_api_name: input.agentApiName,
      agent_file: input.agentFile,
      bot_id: input.botId,
      bot_version_id: input.botVersionId,
      version_number: input.versionNumber,
      status: input.status,
      source: input.source,
    },
  ];
}

// -------------------------------------------------------------------------------------------------
// action = publish
// -------------------------------------------------------------------------------------------------

export async function actionPublish(
  ctx: ExtensionContext,
  input: PublishLifecycleActionInput,
  stream: (msg: string) => void,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }

  let analysis;
  try {
    analysis = timings
      ? await timings.time("load_analysis_snapshot", () => getAgentScriptAnalysis(filePath))
      : await getAgentScriptAnalysis(filePath);
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const source = analysis.source;

  const localCheck = timings
    ? await timings.time("local_compile", () => analysis.getCompile())
    : await analysis.getCompile();
  if (!localCheck.ok) {
    return toolError(
      localCheck.unavailableReason ?? "Local Agent Script compile failed before publish.",
      "Run agentscript_authoring compile/check to see the full diagnostic details.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }
  const blocking = localCheck.diagnostics.filter((d) => d.severity === 1);
  if (blocking.length > 0) {
    return toolError(
      `Local diagnostics rejected publish (${blocking.length} severity-1 issue${blocking.length === 1 ? "" : "s"}).`,
      "Run agentscript_authoring compile/check to see and fix the diagnostics before publishing.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }

  const agentApiName = input.agent_api_name ?? path.basename(filePath, ".agent");
  const quality = timings
    ? await timings.time("quality_analysis", () => analysis.getQuality())
    : await analysis.getQuality();
  const qualityGate = evaluateQualityPublicationGate(
    agentApiName,
    quality,
    sessionQualityOverrideLedger(),
    input.acknowledge_quality_risk === true,
  );
  if (!qualityGate.proceed) {
    const highFindings = quality.findings.filter((finding) => finding.severity === "high");
    const lines = [
      `Agent Script quality paused publish for ${agentApiName}.`,
      ...qualityGate.newRiskIds.map((riskId) => {
        const finding = highFindings.find((candidate) => candidate.rule_id === riskId);
        return finding
          ? `  • ${finding.rule_name} (${riskId}) at L${finding.line}: ${finding.message}`
          : `  • ${riskId}: ${quality.failure_reason ?? "quality analysis did not complete"}`;
      }),
      "Review the evidence, then retry with acknowledge_quality_risk=true to approve these risk classes for this bundle and current session.",
    ];
    return toolError(
      lines.join("\n"),
      undefined,
      {
        tool: LIFECYCLE_TOOL_NAME,
        params: {
          action: "publish",
          agent_file: filePath,
          ...(input.target_org ? { target_org: input.target_org } : {}),
          ...(input.agent_api_name ? { agent_api_name: input.agent_api_name } : {}),
          acknowledge_quality_risk: true,
        },
      },
      {
        action: "publish.quality_gate",
        quality_gate: {
          file: filePath,
          agent_api_name: agentApiName,
          risk_ids: qualityGate.riskIds,
          new_risk_ids: qualityGate.newRiskIds,
          quality,
        },
      },
    );
  }

  const actionableQualityFindings = quality.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "moderate",
  );
  const qualityAdvisory =
    actionableQualityFindings.length > 0
      ? {
          count: actionableQualityFindings.length,
          rule_ids: Array.from(
            new Set(actionableQualityFindings.map((finding) => finding.rule_id)),
          ),
        }
      : undefined;

  let featureProfile: AgentFeatureProfile | undefined;
  try {
    const inspect = timings
      ? await timings.time("inspect_structure", () => analysis.getInspect())
      : await analysis.getInspect();
    if (inspect.ok) {
      featureProfile = (await analysis.getFeatureProfile()) ?? buildFeatureProfile(inspect);
      for (const risk of featureProfile.publish_risks) {
        stream(`Pre-flight warning — ${risk.message}`);
      }
    }
  } catch {
    // Feature-risk classification is advisory. Publish preflight below still runs.
  }

  // The bundle directory contains both the `.agent` file and the
  // `.bundle-meta.xml` file. SDR's ComponentSet.fromSource(bundleDir)
  // walks both and zips them up for the deploy().
  const bundleDir = path.dirname(filePath);

  try {
    const conn = timings
      ? await timings.time("org_connection", () => connFromAlias(input.target_org))
      : await connFromAlias(input.target_org);

    // Service-Agent preflight: a missing/inactive user or unassigned
    // system PS is the #1 reason publish fails with a cryptic message.
    // Doing the cheap check here lets us return a clean recover_via
    // before the SFAP round-trip. Employee Agents return status='n/a'
    // and we proceed without disruption. See agent-user-setup.md skill.
    const cfg = await readAgentConfigSlice(filePath);
    if (cfg.ok && cfg.agent_type === "AgentforceServiceAgent") {
      const status = timings
        ? await timings.time("service_agent_user_preflight", () =>
            checkAgentUserStatus(conn, {
              agent_type: cfg.agent_type,
              default_agent_user: cfg.default_agent_user,
            }),
          )
        : await checkAgentUserStatus(conn, {
            agent_type: cfg.agent_type,
            default_agent_user: cfg.default_agent_user,
          });
      if (!status.ok) {
        stream(`Pre-flight — Service Agent user wiring: ${status.short_message}`);
        return toolError(
          `Service Agent preflight failed: ${status.short_message}`,
          "Run agentscript_lifecycle action='diagnose_agent_user' to see the full checklist, then 'provision_agent_user' (defaults to dry_run=true) to fix.",
          {
            tool: LIFECYCLE_TOOL_NAME,
            params: {
              action: "agent_user_status",
              agent_file: filePath,
              ...(input.target_org ? { target_org: input.target_org } : {}),
            },
          },
        );
      }
    }
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org, { signal });
    authPhase?.end({ cache: auth.cache });
    const { conn: agentApiConn } = auth;
    const result = await publishAgent({
      conn,
      agentApiConn,
      agentSource: source,
      agentFilePath: filePath,
      bundleDir,
      agentApiName,
      log: stream,
      timings,
      localCompileChecked: true,
      inspectResult: await analysis.getInspect(),
      signal,
    });
    const ab = result.authoring_bundle;
    const bundleLine = ab
      ? ab.error
        ? `  ⚠️ AiAuthoringBundle deploy did not complete (Agent API publish still succeeded; Agent Script Studio may fall back to legacy builder): ${ab.error.slice(0, 200)}`
        : `  • AiAuthoringBundle deploy succeeded: ${ab.full_name} (target=${ab.target}, ${ab.created ? "created" : "updated"})`
      : `  • AiAuthoringBundle deploy skipped/not reported`;
    const missing = result.preflight?.missing_action_targets ?? [];
    const runtimeUnready = result.preflight?.runtime_unready_targets ?? [];
    const transitiveWarnings = result.preflight?.transitive_connected_warnings ?? [];
    const preflightLines: string[] = [];
    for (const risk of featureProfile?.publish_risks ?? []) {
      preflightLines.push(`  ⚠️ ${risk.message}`);
      for (const evidence of risk.evidence.slice(0, 3)) {
        preflightLines.push(`     • ${evidence}`);
      }
    }
    if (missing.length > 0) {
      preflightLines.push(
        `  ⚠️ ${missing.length} action target(s) missing in org (preview will fail until deployed):`,
      );
      for (const m of missing.slice(0, 4)) {
        preflightLines.push(`     • ${m.name} → ${m.scheme}://${m.ref_name}`);
      }
      if (missing.length > 4) {
        preflightLines.push(`     …and ${missing.length - 4} more in details.preflight`);
      }
    }
    if (runtimeUnready.length > 0) {
      preflightLines.push(
        `  ⚠️ ${runtimeUnready.length} connected agent target(s) exist but are not runtime-ready:`,
      );
      for (const target of runtimeUnready.slice(0, 4)) {
        preflightLines.push(`     • ${target.name} → ${target.ref_name} — ${target.detail}`);
      }
    }
    if (transitiveWarnings.length > 0) {
      preflightLines.push(
        `  ⚠️ ${transitiveWarnings.length} transitive connected-agent readiness warning(s):`,
      );
      for (const warning of transitiveWarnings.slice(0, 4)) {
        preflightLines.push(`     • ${warning.path.join(" → ")} — ${warning.detail}`);
      }
    }
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: result.developer_name,
          bot_id: result.bot_id,
          bot_version_id: result.bot_version_id,
          version_developer_name: result.version_developer_name,
          was_new_agent: result.was_new_agent,
          activated: result.activated,
          authoring_bundle: result.authoring_bundle,
          ...(qualityAdvisory ? { quality_advisory: qualityAdvisory } : {}),
          ...(result.preflight ? { preflight: result.preflight } : {}),
          ...(featureProfile?.publish_risks.length
            ? { publish_risks: featureProfile.publish_risks }
            : {}),
        },
        lifecycleVersionEvents({
          agentApiName: result.developer_name,
          agentFile: filePath,
          botId: result.bot_id,
          botVersionId: result.bot_version_id,
          status: result.activated ? "Active" : undefined,
          source: "lifecycle.publish",
        }),
      ),
      [
        `📦 Published ${result.developer_name}`,
        result.was_new_agent ? "  • created new agent" : "  • new version of existing agent",
        `  • Agent API publish succeeded: bot_version_id=${result.bot_version_id}`,
        bundleLine,
        "  • published inactive; run agentscript_eval action='run_release' against this exact version before activation",
        ...(qualityAdvisory
          ? [
              `  ⚠️ ${qualityAdvisory.count} quality recommendation(s) remain (${qualityAdvisory.rule_ids.join(", ")}); resolve them before activation`,
            ]
          : []),
        ...preflightLines,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Pre-flight failure. The same exception class covers two distinct
    // checks (bundle XML, action targets); we route on the message prefix.
    if (err instanceof Error && err.name === "PreflightFailureError") {
      const path = (err as { path?: string }).path;
      if (/Bundle XML is invalid/i.test(msg)) {
        return toolError(
          msg,
          "Add `<bundleType>AGENT</bundleType>` inside `<AiAuthoringBundle>` and retry. " +
            "Scaffolds produced by `agentscript_authoring` create already include this field.",
          path
            ? {
                tool: "edit",
                params: { path, find: "<AiAuthoringBundle", replace: "<AiAuthoringBundle" },
              }
            : undefined,
        );
      }
      // Action-target preflight failure — point at check_targets so the LLM
      // can drill into the per-target breakdown without re-reading prose.
      return toolError(
        msg,
        "Run agentscript_authoring inspect/check_targets for a per-target breakdown. Then deploy the missing flows / apex classes and retry.",
        {
          tool: "agentscript_authoring",
          params: {
            verb: "inspect",
            mode: "check_targets",
            agent_file: filePath,
            target_org: input.target_org ?? "<alias>",
          },
        },
      );
    }
    if (/Local compile rejected/i.test(msg)) {
      return toolError(msg, undefined, {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      });
    }
    return classifyLifecycleError(err, agentApiName, "publish", filePath, featureProfile);
  }
}

// -------------------------------------------------------------------------------------------------
// action = activate / deactivate
// -------------------------------------------------------------------------------------------------

export async function actionActivate(
  ctx: ExtensionContext,
  input: ReleaseLifecycleActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // checkRequired guarantees agent_api_name is set for action='activate'.
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const versions = await listVersions(conn, agentApiName, { signal });
    const targetVersion = input.version
      ? versions.versions.find((candidate) => candidate.version_number === input.version)
      : [...versions.versions].sort((a, b) => b.version_number - a.version_number)[0];
    if (!targetVersion) {
      return toolError(
        input.version
          ? `Agent ${agentApiName} has no version ${input.version}.`
          : `Agent ${agentApiName} has no versions to activate.`,
        "Run agentscript_lifecycle action='list_versions' to inspect available versions.",
      );
    }

    let activationEvidence: Awaited<ReturnType<typeof evaluateActivationEvidence>> | undefined;
    if (targetVersion.status !== "Active") {
      const identity = await resolveOrgIdentity(conn, { signal });
      activationEvidence = await evaluateActivationEvidence({
        cwd: ctx.cwd,
        orgId: identity.org_id,
        agentApiName,
        botVersionId: targetVersion.bot_version_id,
        releaseSpecPath: input.release_spec_path,
      });
      if (!activationEvidence.proceed && input.acknowledge_untested_activation !== true) {
        return toolError(
          `Activation blocked for ${agentApiName} v${targetVersion.version_number}: missing release eval evidence (${activationEvidence.missing.join(", ")}).`,
          "Run the exact-version release contract, then retry activation. Emergency activation requires acknowledge_untested_activation=true and a distinct Guardrail approval.",
          {
            tool: "agentscript_eval",
            params: {
              action: "run_release",
              agent_file: input.agent_file ?? "<path-to-agent-file>",
              agent_api_name: agentApiName,
              ...(input.target_org ? { target_org: input.target_org } : {}),
              ...(input.release_spec_path ? { release_spec_path: input.release_spec_path } : {}),
            },
          },
          { activation_evidence: activationEvidence },
        );
      }
    }

    // Issue 6 — optional divergence preflight when caller passed agent_file.
    // Soft warning only: we surface it on the response but proceed with
    // the activation. The user may have intentionally activated an older
    // version (e.g. rollback); blocking would be too strict.
    let divergenceWarning: string | undefined;
    let divergenceDetails: Record<string, unknown> | undefined;
    if (input.agent_file) {
      const resolvedFile = safeResolveToolPath(input.agent_file, ctx.cwd);
      if ("absPath" in resolvedFile) {
        const div = await checkBundleVsBotDivergence(conn, agentApiName, resolvedFile.absPath);
        divergenceDetails = { ...div };
        if (div.ok && div.diverged) {
          divergenceWarning = `⚠️  ${div.detail}`;
        }
      }
    }

    const row = await activateVersion({
      conn,
      agentApiName,
      version: input.version,
      signal,
    });
    const evalHint = activationEvidence?.proceed
      ? `\n\n✓ Exact-version release eval contract satisfied by ${activationEvidence.evidence.map((item) => item.run_id).join(", ")}.`
      : "";
    const headerLines: string[] = [`🟢 ${agentApiName} v${row.VersionNumber} activated`];
    if (input.acknowledge_untested_activation === true && !activationEvidence?.proceed) {
      headerLines.push("", "⚠️ Activated through the Guardrail-approved untested emergency path.");
    }
    if (divergenceWarning) headerLines.push("", divergenceWarning);
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: agentApiName,
          bot_version_id: row.Id,
          version_number: row.VersionNumber,
          status: row.Status,
          ...(activationEvidence ? { activation_evidence: activationEvidence } : {}),
          ...(input.acknowledge_untested_activation === true && !activationEvidence?.proceed
            ? { untested_activation_override: true }
            : {}),
          ...(divergenceDetails ? { divergence: divergenceDetails } : {}),
        },
        lifecycleVersionEvents({
          agentApiName,
          agentFile: input.agent_file,
          botVersionId: row.Id,
          versionNumber: row.VersionNumber,
          status: row.Status,
          source: "lifecycle.activate",
        }),
      ),
      headerLines.join("\n") + evalHint,
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "activate");
  }
}

export async function actionDeactivate(
  input: ReleaseLifecycleActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const row = await deactivateVersion({
      conn,
      agentApiName,
      version: input.version,
      signal,
    });
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: agentApiName,
          bot_version_id: row.Id,
          version_number: row.VersionNumber,
          status: row.Status,
        },
        lifecycleVersionEvents({
          agentApiName,
          botVersionId: row.Id,
          versionNumber: row.VersionNumber,
          status: row.Status,
          source: "lifecycle.deactivate",
        }),
      ),
      `⚫ ${agentApiName} v${row.VersionNumber} deactivated`,
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "deactivate");
  }
}

// -------------------------------------------------------------------------------------------------
// action = list_versions
// -------------------------------------------------------------------------------------------------

export async function actionListVersions(
  input: ReleaseLifecycleActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const result = await listVersions(conn, agentApiName, { signal });
    const lines = [
      `📋 Versions of ${result.agent_api_name} (bot_id ${result.bot_id})`,
      ...result.versions.map((v) => {
        const flag = v.status === "Active" ? "🟢" : "⚪";
        return `  ${flag} v${v.version_number} · ${v.status} · ${v.bot_version_id} · ${v.developer_name ?? ""}`;
      }),
    ];
    const active = result.versions.find((v) => v.status === "Active") ?? result.versions[0];
    return toolOk(
      withAgentScriptBranchState(
        { ok: true as const, ...result },
        active
          ? lifecycleVersionEvents({
              agentApiName: result.agent_api_name,
              botId: result.bot_id,
              botVersionId: active.bot_version_id,
              versionNumber: active.version_number,
              status: active.status,
              source: "lifecycle.list_versions",
            })
          : [],
      ),
      lines.join("\n"),
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "list_versions");
  }
}

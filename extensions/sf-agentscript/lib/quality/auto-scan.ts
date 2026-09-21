/* SPDX-License-Identifier: Apache-2.0 */
/** Actionable pre-settlement Agent Script quality pass and bounded repair loop. */
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { getAgentScriptAnalysis } from "../analysis-snapshot.ts";
import { isAgentScriptFile, resolveToolPath } from "../file-classify.ts";
import { readEffectiveAgentScriptQualitySettings } from "./settings.ts";
import {
  AGENT_SCRIPT_QUALITY_REPAIR_MESSAGE_TYPE,
  buildQualityRepairPayload,
  qualityCardData,
} from "./presentation.ts";
import type { AgentScriptQualityFinding, AgentScriptQualityResult } from "./types.ts";

export const AGENT_SCRIPT_QUALITY_ENTRY_TYPE = "sf-agentscript-quality";

interface QualitySettingsLike {
  autoRun: boolean;
}

export interface DeferredAgentScriptQualityDeps {
  readSettings?: () => QualitySettingsLike;
  runQualityFile?: (file: string) => Promise<AgentScriptQualityResult>;
}

export function registerDeferredAgentScriptQuality(
  pi: ExtensionAPI,
  deps: DeferredAgentScriptQualityDeps = {},
): void {
  const pending = new Set<string>();
  const signatures = new Map<string, string>();
  const attempts = new Map<string, number>();
  const readSettings = deps.readSettings ?? readEffectiveAgentScriptQualitySettings;
  const runQualityFile = deps.runQualityFile ?? runFile;

  pi.on("tool_result", async (event, ctx) => {
    collectFile(event, ctx, pending);
  });

  pi.on("agent_before_settle", async (event) => {
    if (pending.size === 0) return;
    if (!readSettings().autoRun) {
      pending.clear();
      return;
    }

    const files = [...pending].sort();
    const entries = [...event.entries];
    pending.clear();
    for (const file of files) {
      const quality = await runQualityFile(file);
      const actionable = quality.findings.filter(
        (finding) => finding.severity === "high" || finding.severity === "moderate",
      );
      const signature = findingSignature(actionable);
      const priorAttempt = attempts.get(file) ?? 0;

      if (!quality.ok || quality.status === "failed" || actionable.length === 0) {
        emitQualityCard(pi, file, quality, {
          ...(quality.status === "clean" && priorAttempt > 0
            ? {
                state: "fixed" as const,
                repair: { attempt: priorAttempt, signature: signatures.get(file) ?? "" },
              }
            : {}),
        });
        signatures.delete(file);
        attempts.delete(file);
        continue;
      }

      if (signatures.get(file) === signature) {
        emitQualityCard(pi, file, quality, {
          state: "stopped",
          repair: { attempt: Math.max(1, priorAttempt), signature },
          message: "No further automatic repair was scheduled.",
        });
        continue;
      }

      const attempt = priorAttempt + 1;
      signatures.set(file, signature);
      attempts.set(file, attempt);
      emitQualityCard(pi, file, quality, {
        state: "repairing",
        repair: { attempt, signature },
      });
      const payload = buildQualityRepairPayload(file, actionable, attempt, signature);
      entries.push({
        type: "custom_message",
        customType: AGENT_SCRIPT_QUALITY_REPAIR_MESSAGE_TYPE,
        content: JSON.stringify(payload),
        display: false,
        details: {
          file,
          attempt,
          finding_signature: signature,
          finding_count: payload.findings.length,
        },
      });
    }

    if (entries.length === event.entries.length) return;
    return { entries, continue: true };
  });

  pi.on("session_shutdown", () => {
    pending.clear();
    signatures.clear();
    attempts.clear();
  });
}

function collectFile(event: ToolResultEvent, ctx: ExtensionContext, pending: Set<string>): void {
  if (event.isError || (!isEditToolResult(event) && !isWriteToolResult(event))) return;
  const rawPath = event.input?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return;
  const file = resolveToolPath(rawPath, ctx.cwd);
  if (isAgentScriptFile(file)) pending.add(file);
}

async function runFile(file: string): Promise<AgentScriptQualityResult> {
  return (await getAgentScriptAnalysis(file)).getQuality();
}

function emitQualityCard(
  pi: ExtensionAPI,
  file: string,
  quality: AgentScriptQualityResult,
  options: Parameters<typeof qualityCardData>[2] = {},
): void {
  pi.appendEntry(AGENT_SCRIPT_QUALITY_ENTRY_TYPE, qualityCardData(file, quality, options));
}

function findingSignature(findings: AgentScriptQualityFinding[]): string {
  return findings
    .map((finding) => `${finding.rule_id}:${finding.line}:${finding.message}`)
    .sort()
    .join("|");
}

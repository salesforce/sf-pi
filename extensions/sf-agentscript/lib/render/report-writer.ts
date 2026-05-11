/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Markdown report writer.
 *
 * Atomically writes a rendered Markdown report alongside other tool
 * artifacts (eval runs, preview sessions). Path layout:
 *
 *   <cwd>/.sfdx/agents/<agent_name>/reports/<filename>.md      # per-agent
 *   <cwd>/.sfdx/agents/_runs/<run_id>/report.md                # eval run
 *   <run_dir>/report.md                                        # legacy hint
 *
 * The carve-out for `.sfdx/agents/**` is documented in
 * AGENTS.md / sf-guardrail's allow-list, so writes stay safe.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ReportWriteResult {
  path: string;
  bytes: number;
}

/**
 * Write `content` atomically to `targetPath`, creating parent directories
 * as needed. Returns the absolute path.
 *
 * Atomicity: write to `<file>.tmp` first, then rename. On a crash mid-write
 * the temp file is left behind; the original (or absent file) stays clean.
 */
export async function writeMarkdownReport(
  targetPath: string,
  content: string,
): Promise<ReportWriteResult> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, targetPath);
  return { path: targetPath, bytes: Buffer.byteLength(content, "utf-8") };
}

/** Build the absolute path for an eval run's report. */
export function evalReportPath(runDir: string): string {
  return join(runDir, "report.md");
}

/**
 * Build the absolute path for a per-session preview report:
 *   .sfdx/agents/<agent>/sessions/<sid>/reports/<plan_id>.md
 *
 * The session directory is already inside the guarded `.sfdx/agents` tree,
 * so this just appends a `reports/<plan_id>.md` leaf.
 */
export function previewReportPath(sessionDir: string, planId: string): string {
  return join(sessionDir, "reports", `${planId}.md`);
}

/**
 * Build the absolute path for a generic agent-scoped report under
 *   <cwd>/.sfdx/agents/<agent>/reports/<filename>
 *
 * The caller picks `<filename>`; we ensure `.md` suffix.
 */
export function agentReportPath(cwd: string, agentName: string, filename: string): string {
  const safeName = sanitizeName(agentName);
  const fname = filename.endsWith(".md") ? filename : `${filename}.md`;
  return join(cwd, ".sfdx", "agents", safeName, "reports", fname);
}

/**
 * Sanitize a name for use as a directory segment. Strips path separators
 * and limits length so we don't produce surprising paths from caller input.
 */
function sanitizeName(name: string): string {
  return (name || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

// -------------------------------------------------------------------------------------------------
// Header helpers
// -------------------------------------------------------------------------------------------------

/**
 * Build a small Markdown frontmatter-ish header for saved reports so the
 * file is self-describing when read on its own.
 */
export function reportHeader(opts: {
  kind: "eval" | "preview" | "compile" | "inspect" | "lifecycle";
  title: string;
  generatedAt?: Date;
  meta?: Record<string, string | number | undefined>;
}): string {
  const ts = (opts.generatedAt ?? new Date()).toISOString();
  const lines = [`# ${opts.title}`, "", `_Generated: ${ts}_`, `_Kind: ${opts.kind}_`];
  if (opts.meta) {
    for (const [k, v] of Object.entries(opts.meta)) {
      if (v === undefined || v === null || v === "") continue;
      lines.push(`_${k}: ${v}_`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

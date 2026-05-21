/* SPDX-License-Identifier: Apache-2.0 */
/** Human-readable Browser Evidence reports for /sf-browser. */
import {
  getEvidenceDir,
  getEvidenceIndexPath,
  getLatestEvidencePointerPath,
  latestEvidenceCaptures,
  type BrowserEvidenceCapture,
} from "./artifacts.ts";

export function buildEvidenceReport(sessionId: string, limit = 10): string {
  const captures = latestEvidenceCaptures(limit, sessionId);
  const lines = [
    "Browser Evidence for current pi session",
    `Session: ${sessionId}`,
    `Directory: ${getEvidenceDir(sessionId)}`,
    `Index: ${getEvidenceIndexPath(sessionId)}`,
    `Latest pointer: ${getLatestEvidencePointerPath()}`,
    "",
  ];

  if (!captures.length) {
    lines.push("No Browser Evidence captures recorded for this session yet.");
    lines.push("Use /sf-browser screenshot or sf_browser_capture_evidence to capture one.");
    return lines.join("\n");
  }

  lines.push(`Recent captures (${captures.length}):`);
  for (const capture of captures) lines.push(...formatCaptureLines(capture));
  return lines.join("\n");
}

export function formatCaptureLines(capture: BrowserEvidenceCapture): string[] {
  return [
    `- #${capture.id} ${capture.label}`,
    `  Created: ${capture.createdAt}`,
    capture.url ? `  URL: ${capture.url}` : undefined,
    `  Image mode: ${capture.imageMode}; image included: ${capture.includedImage ? "yes" : "no"}`,
    `  Path: ${capture.path}`,
    capture.thumbnailPath ? `  Thumbnail: ${capture.thumbnailPath}` : undefined,
    capture.setupAuditTrail ? `  Setup Audit Trail: ${formatAuditStatus(capture)}` : undefined,
  ].filter((line): line is string => !!line);
}

function formatAuditStatus(capture: BrowserEvidenceCapture): string {
  const audit = capture.setupAuditTrail;
  if (!audit) return "not requested";
  if (audit.status === "queried")
    return `queried, ${audit.rowCount ?? audit.rows?.length ?? 0} row(s)`;
  if (audit.status === "skipped") return `skipped${audit.error ? ` (${audit.error})` : ""}`;
  return `unavailable${audit.error ? ` (${audit.error})` : ""}`;
}

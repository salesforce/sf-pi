/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session-scoped report artifact paths for SF Code Analyzer.
 *
 * Reports live outside the project tree by default so automatic and explicit
 * scans do not dirty source control. Tool-result details carry the report path
 * so branch-local state can recover the latest report without a global DB.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

export function codeAnalyzerArtifactDir(ctx: ExtensionContext): string {
  const sessionId = safeSegment(ctx.sessionManager.getSessionId?.() ?? "unknown-session");
  const leaf = safeSegment(path.basename(ctx.cwd) || "workspace");
  const dir = globalAgentPath("sf-pi", "code-analyzer", "sessions", `${leaf}-${sessionId}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function nextReportPath(
  ctx: ExtensionContext,
  kind: "run" | "rules" | "config",
  extension: "json" | "yml" = "json",
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${stamp}-${kind}.${extension}`;
  return path.join(codeAnalyzerArtifactDir(ctx), file);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

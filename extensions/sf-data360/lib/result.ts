/* SPDX-License-Identifier: Apache-2.0 */
/** Model, structured, artifact, and Run Card result seam for sf_data360. */
import type { SfPiToolResultEnvelope } from "../../../lib/common/display/types.ts";
import { buildData360Digest, compactDigestText, structuredResultFromDigest } from "./digest.ts";
import { writeFullD360Output } from "./truncation.ts";
import type { SfData360Input } from "./actions/action-types.ts";
import type { SfData360ToolResult } from "./types.ts";

export async function presentSfData360Result(
  input: SfData360Input,
  result: Record<string, unknown>,
  outputMode: "summary" | "inline" | "file_only",
): Promise<SfData360ToolResult> {
  const raw = JSON.stringify(result, null, 2);
  const artifactPath =
    outputMode === "file_only" || shouldPersist(result, raw)
      ? await writeFullD360Output(raw)
      : undefined;
  const digest = buildData360Digest({ input, result, artifactPath, outputMode });
  const structuredContent = structuredResultFromDigest(digest, result);
  const text =
    outputMode === "inline"
      ? inlineDigestText(digest)
      : outputMode === "file_only"
        ? `${compactDigestText(digest)} Full result: ${artifactPath}`
        : compactDigestText(digest);
  const ok = result.ok !== false;
  const sfPi = {
    ok,
    action: input.action,
    summary: digest.summary,
    data: { digest, outcome: structuredContent.outcome },
    ...(artifactPath ? { truncation: { truncated: false, fullOutputPath: artifactPath } } : {}),
    renderHints: { profile: "balanced", collapsedLines: 12, expandedMaxLines: 120 },
  } as SfPiToolResultEnvelope;
  return {
    content: [{ type: "text", text }],
    structuredContent,
    details: {
      ...result,
      digest,
      outcome: structuredContent.outcome,
      ...(artifactPath ? { artifactPath } : {}),
      sfPi,
    },
  };
}

function inlineDigestText(digest: SfData360ToolResult["details"]["digest"]): string {
  const lines = [compactDigestText(digest)];
  const results = digest.sections.find((section) => section.title === "Results");
  if (results?.table) {
    lines.push("", results.table.columns.join(" | "));
    for (const row of results.table.rows.slice(0, 5)) lines.push(row.join(" | "));
    if (results.table.omittedRows) lines.push(`… ${results.table.omittedRows} more row(s)`);
  }
  const metadata = digest.sections.find((section) => section.title === "Data Object");
  if (metadata?.rows?.length) {
    lines.push("", ...metadata.rows.slice(0, 6).map((row) => `${row.label}: ${row.value}`));
  }
  const warnings = digest.sections.find((section) => section.title === "Warnings");
  if (warnings?.rows?.length) {
    lines.push("", ...warnings.rows.slice(0, 3).map((row) => `Warning: ${row.value}`));
  }
  return lines.join("\n");
}

function shouldPersist(result: Record<string, unknown>, raw: string): boolean {
  const responseLines =
    result.response === undefined ? 0 : JSON.stringify(result.response, null, 2).split("\n").length;
  return (
    result.ok === false ||
    raw.length > 12_000 ||
    responseLines > 45 ||
    Array.isArray(result.executionChain) ||
    Boolean(result.journey || result.runbook)
  );
}
